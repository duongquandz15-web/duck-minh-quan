const SIZE=8;
const SUPABASE_CONFIG=window.DUCK_SUPABASE_CONFIG;
const AUTH_STORAGE_KEY='duckSupabaseSession';
const SIGNUP_COOLDOWN_KEY='duckSignupRetryAt';
let accountRequestPending=false,signupCooldownTimer=null;
const authCallback=new URLSearchParams(location.hash.slice(1));
let recoveryAccessToken=authCallback.get('type')==='recovery'?authCallback.get('access_token'):null;
const recoveryCallbackError=authCallback.get('error_description')||authCallback.get('error');
if(recoveryAccessToken||recoveryCallbackError)history.replaceState(null,document.title,`${location.pathname}${location.search}`);
const boardEl=document.getElementById('board'), trayEl=document.getElementById('tray');
const scoreEl=document.getElementById('score'),bestEl=document.getElementById('best'),coinsEl=document.getElementById('coins');
const backgroundMusic=document.getElementById('backgroundMusic');
const storedMusicVolume=localStorage.getItem('duckMusicVolume');
const musicVolume=storedMusicVolume===null?0.24:Math.min(1,Math.max(0,Number(storedMusicVolume)));
backgroundMusic.volume=Number.isFinite(musicVolume)?musicVolume:.24;
function readAuthSession(){try{const saved=JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)||'null');return saved&&typeof saved.access_token==='string'&&typeof saved.refresh_token==='string'?saved:null;}catch(error){console.error('Không thể đọc phiên đăng nhập.',error);return null;}}
let authSession=readAuthSession(),authRefreshPromise=null;
let board=[],score=0,best=Math.max(0,Number(localStorage.getItem('duckBest'))||0),coins=Math.max(0,Number(localStorage.getItem('duckCoins'))||0),pieces=[],selected=-1,paused=false,blockImage=null,drag=null,dragGhost=null,restartTimer=null,dailyCountdownTimer=null,soundEnabled=localStorage.getItem('duckSound')!=='false',musicEnabled=false,musicPreferred=localStorage.getItem('duckMusic')!=='false',audioContext=null;
bestEl.textContent=best;coinsEl.textContent=coins;
const SHAPES=[
 [[0,0],[1,0],[2,0],[3,0]],
 [[0,0],[1,0],[0,1],[1,1]],
 [[0,0],[1,0],[2,0],[1,1]],
 [[1,0],[2,0],[0,1],[1,1]],
 [[0,0],[1,0],[1,1],[2,1]],
 [[0,0],[0,1],[1,1],[2,1]],
 [[2,0],[0,1],[1,1],[2,1]],
 [[0,0]],
 [[0,0],[1,0]],
 [[0,0],[1,0],[2,0]],
 [[0,0],[1,0],[2,0],[3,0],[4,0]],
 [[0,0],[0,1],[0,2],[1,2],[2,2]]
];
const REMOVED_SHAPES=[
 [[1,0],[0,1],[1,1],[2,1],[1,2]],
 [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]],
 [[0,0],[1,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]]
];
function rotateShape(shape){const maxY=Math.max(...shape.map(([,y])=>y));return shape.map(([x,y])=>[maxY-y,x]);}
function shapeKey(shape){const minX=Math.min(...shape.map(([x])=>x)),minY=Math.min(...shape.map(([,y])=>y));return shape.map(([x,y])=>[x-minX,y-minY]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]).map(([x,y])=>`${x},${y}`).join(';');}
const REMOVED_SHAPE_KEYS=new Set(REMOVED_SHAPES.flatMap(shape=>{const keys=[];for(let turn=0;turn<4;turn++){keys.push(shapeKey(shape));shape=rotateShape(shape);}return keys;}));
function restorePieces(savedPieces){return savedPieces.map(piece=>piece?{shape:REMOVED_SHAPE_KEYS.has(shapeKey(piece.shape))?randomShape():piece.shape.map(cell=>[...cell]),color:piece.color}:null);}
function randomShape(){let shape=SHAPES[Math.floor(Math.random()*SHAPES.length)].map(cell=>[...cell]);for(let turn=0;turn<Math.floor(Math.random()*4);turn++)shape=rotateShape(shape);return shape;}
const COLORS=['#ffb900','#f23d48','#238ef2','#40c83d','#a54ee8','#ff7b20'];
const SHOP_ITEMS=[{id:'reroll',name:'Đổi khay khối',icon:'🎲',price:10,description:'Đổi toàn bộ khối còn lại để tìm thế đi mới.'},{id:'hammer',name:'Búa phá khối',icon:'🔨',price:25,description:'Đập vùng 3×3 quanh ô chọn để mở đường, tối đa 9 ô.'},{id:'undo',name:'Hoàn tác',icon:'↩️',price:35,description:'Hoàn lại nước đặt khối gần nhất trong ván này.'}];
const BOARD_THEMES=[{id:'sunset',name:'Hoàng hôn',icon:'🌅',price:100},{id:'forest',name:'Rừng xanh',icon:'🌿',price:150}];
const ACHIEVEMENTS=[
 {id:'first-block',icon:'🧱',name:'Khởi đầu',description:'Đặt khối đầu tiên',metric:'placements',target:1,coins:10},
 {id:'first-clear',icon:'✨',name:'Dọn bàn',description:'Xóa hàng hoặc cột đầu tiên',metric:'clearedLines',target:1,coins:15},
 {id:'score-100',icon:'🚀',name:'Vào guồng',description:'Đạt 100 điểm trong một ván',metric:'runScore',target:100,coins:20},
 {id:'ten-games',icon:'🎮',name:'Kiên trì',description:'Chơi xong 10 ván',metric:'games',target:10,coins:30},
 {id:'forest-master',icon:'🌿',name:'Nhà thám hiểm',description:'Xóa tổng cộng 25 hàng hoặc cột',metric:'clearedLines',target:25,coins:40,theme:'forest'}
];
const ACHIEVEMENT_STORAGE_KEY='duckAchievementProgress';
let achievementProgress=readAchievementProgress();
let inventory=readShopInventory(),lastMoveSnapshot=null,hammerMode=false;
const HAMMER_RADIUS=1;
boardEl.addEventListener('pointerover',event=>{const cell=event.target.closest('.cell');if(cell&&hammerMode)updateHammerPreview(Number(cell.dataset.row),Number(cell.dataset.col));});
boardEl.addEventListener('pointerleave',clearHammerPreview);
function readShopInventory(){try{const storedInventory=localStorage.getItem('duckShopInventory');if(storedInventory===null){const starterInventory={reroll:2,hammer:2,undo:2,themes:[]};localStorage.setItem('duckShopInventory',JSON.stringify(starterInventory));localStorage.setItem('duckStarterPackPending','true');return starterInventory;}const saved=JSON.parse(storedInventory);return {reroll:Math.max(0,Number(saved.reroll)||0),hammer:Math.max(0,Number(saved.hammer)||0),undo:Math.max(0,Number(saved.undo)||0),themes:Array.isArray(saved.themes)?saved.themes.filter(theme=>['sunset','forest'].includes(theme)):[]};}catch(error){console.error('Không thể đọc túi đồ cửa hàng.',error);return {reroll:0,hammer:0,undo:0,themes:[]};}}
function readAchievementProgress(){try{const saved=JSON.parse(localStorage.getItem(ACHIEVEMENT_STORAGE_KEY)||'{}');return {placements:Math.max(0,Number(saved.placements)||0),clearedLines:Math.max(0,Number(saved.clearedLines)||0),unlocked:Array.isArray(saved.unlocked)?saved.unlocked.filter(id=>ACHIEVEMENTS.some(achievement=>achievement.id===id)):[]};}catch(error){console.error('Không thể đọc tiến độ thành tựu.',error);return {placements:0,clearedLines:0,unlocked:[]};}}
function saveAchievementProgress(){localStorage.setItem(ACHIEVEMENT_STORAGE_KEY,JSON.stringify(achievementProgress));}
function saveShopInventory(){localStorage.setItem('duckShopInventory',JSON.stringify(inventory));renderLobbyPowerups();}
function isValidSavedBoard(value){return Array.isArray(value)&&value.length===SIZE&&value.every(row=>Array.isArray(row)&&row.length===SIZE&&row.every(cell=>cell===null||typeof cell==='string'));}
function isValidSavedPieces(value){return Array.isArray(value)&&value.length===3&&value.every(piece=>piece===null||piece&&Array.isArray(piece.shape)&&piece.shape.length>0&&piece.shape.every(cell=>Array.isArray(cell)&&cell.length===2&&cell.every(point=>Number.isInteger(point)&&point>=0&&point<SIZE))&&typeof piece.color==='string');}
function saveGame(){try{localStorage.setItem('duckActiveGame',JSON.stringify({board,score,pieces,lastMoveSnapshot,savedAt:Date.now()}));}catch(error){console.error('Không thể lưu ván chơi.',error);}}
function restoreSavedGame(){try{const raw=localStorage.getItem('duckActiveGame');if(!raw)return false;const saved=JSON.parse(raw);if(!isValidSavedBoard(saved.board)||!isValidSavedPieces(saved.pieces)||!Number.isFinite(saved.score)||saved.score<0){throw new TypeError('Dữ liệu ván đã lưu không hợp lệ.');}board=saved.board.map(row=>[...row]);pieces=restorePieces(saved.pieces);score=saved.score;scoreEl.textContent=score;paused=false;selected=-1;hammerMode=false;lastMoveSnapshot=saved.lastMoveSnapshot&&isValidSavedBoard(saved.lastMoveSnapshot.board)&&isValidSavedPieces(saved.lastMoveSnapshot.pieces)&&Number.isFinite(saved.lastMoveSnapshot.score)?{board:saved.lastMoveSnapshot.board.map(row=>[...row]),pieces:restorePieces(saved.lastMoveSnapshot.pieces),score:saved.lastMoveSnapshot.score}:null;renderBoard();renderTray();saveGame();const status=document.getElementById('saveStatus');status.textContent='✅ Đã khôi phục ván trước';status.classList.remove('hidden');setTimeout(()=>status.classList.add('hidden'),4000);return true;}catch(error){console.error('Không thể khôi phục ván đã lưu.',error);localStorage.removeItem('duckActiveGame');return false;}}
function saveAndExit(){saveGame();showModal('VÁN ĐÃ ĐƯỢC LƯU','Tiến trình được lưu tự động trên thiết bị này. Bạn có thể đóng trang bất cứ lúc nào; khi quay lại, ván sẽ tiếp tục từ đúng vị trí hiện tại.');}
function renderLobbyPowerups(){const container=document.getElementById('lobbyPowerupItems');if(!container)return;const usable={reroll:pieces.some(Boolean),hammer:board.some(row=>row.some(Boolean)),undo:!!lastMoveSnapshot};container.innerHTML=SHOP_ITEMS.map(item=>{const count=inventory[item.id],canUse=count>0&&usable[item.id]&&!paused&&!hammerMode,label=count?canUse?'DÙNG':hammerMode?'ĐANG CHỌN Ô':paused?'ĐANG TẠM DỪNG':!usable[item.id]?item.id==='undo'?'CHƯA CÓ NƯỚC ĐI':'CHƯA CÓ KHỐI':'CHƯA DÙNG ĐƯỢC':'VÀO CỬA HÀNG';return `<article class="lobby-powerup"><span class="lobby-powerup-icon">${item.icon}</span><div class="lobby-powerup-copy"><b>${item.name}</b><small>${item.id==='reroll'?'Đổi các khối còn lại':item.id==='hammer'?'Phá vùng 3×3 trên bàn':'Lùi lại nước đi trước'}</small><strong>${count} trong túi</strong></div><button class="lobby-powerup-action" data-lobby-powerup="${item.id}" ${count&&!canUse?'disabled':''}>${label}</button></article>`;}).join('');container.querySelectorAll('[data-lobby-powerup]').forEach(button=>button.onclick=()=>{const id=button.dataset.lobbyPowerup;if(inventory[id])useShopItem(id,false);else showCoinShop();});}
function setCoins(value){coins=Math.max(0,value);coinsEl.textContent=coins;localStorage.setItem('duckCoins',coins);}
function showCoinToast(amount){const toast=document.createElement('div');toast.className='coin-toast';toast.textContent=`+${amount} xu`;document.querySelector('.center-panel').appendChild(toast);setTimeout(()=>toast.remove(),1400);}
function showAchievementToast(message){const toast=document.createElement('div');toast.className='coin-toast achievement-toast';toast.textContent=message;document.querySelector('.center-panel').appendChild(toast);setTimeout(()=>toast.remove(),2200);}
function achievementValue(metric){if(metric==='runScore')return score;if(metric==='games')return Math.max(0,Number(localStorage.getItem('duckGames'))||0);return achievementProgress[metric]||0;}
function renderAchievements(){
 const dashboard=document.getElementById('achievementsDashboard'),unlocked=new Set(achievementProgress.unlocked),completed=unlocked.size;
 dashboard.innerHTML=`<div class="achievement-summary"><span>🏅</span><div><b>${completed}/${ACHIEVEMENTS.length} THÀNH TỰU</b><small>Hoàn thành mục tiêu để nhận xu và vật phẩm.</small></div></div><div class="achievement-list">${ACHIEVEMENTS.map(item=>{const value=achievementValue(item.metric),done=unlocked.has(item.id),progress=Math.min(100,Math.round(value/item.target*100)),reward=item.theme?`+${item.coins} xu · mở bàn Rừng Xanh`:`+${item.coins} xu`;return `<article class="achievement-card ${done?'earned':''}"><span class="achievement-icon">${done?'✅':item.icon}</span><div class="achievement-copy"><b>${item.name}</b><small>${item.description}</small><div class="achievement-progress"><span style="width:${progress}%"></span></div><small>${done?'ĐÃ NHẬN THƯỞNG':`${Math.min(value,item.target).toLocaleString('vi-VN')}/${item.target.toLocaleString('vi-VN')} · ${reward}`}</small></div>${done?'<strong class="achievement-check">✓</strong>':''}</article>`;}).join('')}</div><div class="achievement-note">Tiến độ và phần thưởng được lưu trên thiết bị này.</div>`;
}
function showAchievements(){showModal('THÀNH TỰU','');document.getElementById('modalText').classList.add('hidden');document.getElementById('modalOk').textContent='TIẾP TỤC CHƠI';document.getElementById('achievementsDashboard').classList.remove('hidden');renderAchievements();}
function checkAchievementUnlocks(){
 const newlyUnlocked=ACHIEVEMENTS.filter(item=>!achievementProgress.unlocked.includes(item.id)&&achievementValue(item.metric)>=item.target);
 if(!newlyUnlocked.length)return;
 achievementProgress.unlocked.push(...newlyUnlocked.map(item=>item.id));
 saveAchievementProgress();
 const rewardCoins=newlyUnlocked.reduce((total,item)=>total+item.coins,0);
 const unlockedThemes=newlyUnlocked.filter(item=>item.theme&&!inventory.themes.includes(item.theme));
 if(rewardCoins)setCoins(coins+rewardCoins);
 unlockedThemes.forEach(item=>inventory.themes.push(item.theme));
 if(unlockedThemes.length)saveShopInventory();
 showAchievementToast(`🏅 ${newlyUnlocked[0].name} · +${rewardCoins} xu${unlockedThemes.length?' · 🌿 mở bàn Rừng Xanh':''}`);
 playTreasureSound();
 if(!document.getElementById('achievementsDashboard').classList.contains('hidden'))renderAchievements();
}
function updateAchievementProgress({placements=0,clearedLines=0}={}){achievementProgress.placements+=placements;achievementProgress.clearedLines+=clearedLines;saveAchievementProgress();checkAchievementUnlocks();}
function applyBoardTheme(theme=localStorage.getItem('duckBoardTheme')||'sky'){const safeTheme=['sky','sunset','forest'].includes(theme)?theme:'sky';boardEl.classList.remove('skin-sunset','skin-forest');if(safeTheme!=='sky')boardEl.classList.add(`skin-${safeTheme}`);localStorage.setItem('duckBoardTheme',safeTheme);}
function freshBoard(){board=Array.from({length:SIZE},()=>Array(SIZE).fill(null));score=0;scoreEl.textContent=0;paused=false;lastMoveSnapshot=null;cancelHammerMode();document.body.classList.remove('paused');newPieces();renderBoard();saveGame();}
function newPieces(){pieces=Array.from({length:3},()=>({shape:randomShape(),color:COLORS[Math.floor(Math.random()*COLORS.length)]}));selected=-1;renderTray();}
function renderBoard(){boardEl.innerHTML='';for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++){const cell=document.createElement('button');cell.className='cell'+(board[r][c]?' filled':'');cell.dataset.row=r;cell.dataset.col=c;if(board[r][c]){cell.style.setProperty('--piece-color',board[r][c]);if(blockImage){cell.style.backgroundImage=`url(${blockImage})`;cell.style.backgroundSize='cover';}}cell.addEventListener('click',()=>hammerMode?clearCell(r,c):placeAt(r,c));boardEl.appendChild(cell);}}
function renderTray(){trayEl.innerHTML='';pieces.forEach((p,i)=>{const slot=document.createElement('div');slot.className='piece-slot'+(selected===i?' selected':'')+(!p?' empty':'');if(p){const maxX=Math.max(...p.shape.map(x=>x[0]))+1,maxY=Math.max(...p.shape.map(x=>x[1]))+1;const wrap=document.createElement('div');wrap.className='piece';wrap.style.gridTemplateColumns=`repeat(${maxX},19px)`;wrap.style.gridTemplateRows=`repeat(${maxY},19px)`;p.shape.forEach(([x,y])=>{const d=document.createElement('i');d.className='piece-cell';d.dataset.x=x;d.dataset.y=y;d.style.gridColumn=x+1;d.style.gridRow=y+1;d.style.setProperty('--piece-color',p.color);wrap.appendChild(d);});slot.appendChild(wrap);slot.addEventListener('pointerdown',event=>startDrag(event,i,p,slot));}trayEl.appendChild(slot);});renderLobbyPowerups();}
function startDrag(event,index,piece,slot){if(paused||hammerMode||!piece)return;event.preventDefault();const grabbedCell=event.target.closest('.piece-cell');drag={index,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,grabbedX:grabbedCell?Number(grabbedCell.dataset.x):piece.shape[0][0],grabbedY:grabbedCell?Number(grabbedCell.dataset.y):piece.shape[0][1],slot,piece,moved:false};}
function showDragGhost(clientX,clientY){if(!drag||dragGhost)return;const boardCell=boardEl.querySelector('.cell');if(!boardCell)return;const size=boardCell.getBoundingClientRect().width,gap=parseFloat(getComputedStyle(boardEl).columnGap)||0,maxX=Math.max(...drag.piece.shape.map(([x])=>x))+1,maxY=Math.max(...drag.piece.shape.map(([,y])=>y))+1;dragGhost=document.createElement('div');dragGhost.className='drag-ghost';dragGhost.style.gridTemplateColumns=`repeat(${maxX},${size}px)`;dragGhost.style.gridTemplateRows=`repeat(${maxY},${size}px)`;dragGhost.style.gap=`${gap}px`;dragGhost.style.setProperty('--drag-cell-size',`${size}px`);drag.piece.shape.forEach(([x,y])=>{const cell=document.createElement('i');cell.className='drag-ghost-cell';cell.style.gridColumn=x+1;cell.style.gridRow=y+1;cell.style.setProperty('--piece-color',drag.piece.color);if(blockImage){cell.style.backgroundImage=`url(${blockImage})`;cell.style.backgroundSize='cover';}dragGhost.appendChild(cell);});document.body.appendChild(dragGhost);moveDragGhost(clientX,clientY);}
function moveDragGhost(clientX,clientY){if(!dragGhost||!drag)return;const size=parseFloat(dragGhost.style.getPropertyValue('--drag-cell-size')),gap=parseFloat(dragGhost.style.gap)||0;dragGhost.style.left=`${clientX-size/2-drag.grabbedX*(size+gap)}px`;dragGhost.style.top=`${clientY-size/2-drag.grabbedY*(size+gap)}px`;}
function updatePreview(clientX,clientY){boardEl.querySelectorAll('.preview,.preview-invalid').forEach(cell=>cell.classList.remove('preview','preview-invalid'));const target=document.elementFromPoint(clientX,clientY)?.closest('.cell');if(!drag||!target||!boardEl.contains(target))return;const row=Number(target.dataset.row)-drag.grabbedY,col=Number(target.dataset.col)-drag.grabbedX,piece=pieces[drag.index];if(!piece)return;piece.shape.forEach(([x,y])=>{const cell=boardEl.querySelector(`[data-row="${row+y}"][data-col="${col+x}"]`);if(cell)cell.classList.add(canPlace(piece.shape,row,col)?'preview':'preview-invalid');});}
function clearPreview(){boardEl.querySelectorAll('.preview,.preview-invalid').forEach(cell=>cell.classList.remove('preview','preview-invalid'));}
document.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;if(!drag.moved&&Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>6){drag.moved=true;drag.slot.classList.add('dragging');showDragGhost(event.clientX,event.clientY);}if(drag.moved){event.preventDefault();moveDragGhost(event.clientX,event.clientY);updatePreview(event.clientX,event.clientY);}});
document.addEventListener('pointerup',event=>{if(!drag||event.pointerId!==drag.pointerId)return;const currentDrag=drag;drag=null;currentDrag.slot.classList.remove('dragging');dragGhost?.remove();dragGhost=null;clearPreview();if(!currentDrag.moved){selected=currentDrag.index;renderTray();return;}const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.cell');if(target&&boardEl.contains(target))placeAt(Number(target.dataset.row)-currentDrag.grabbedY,Number(target.dataset.col)-currentDrag.grabbedX,currentDrag.index);});
function canPlace(shape,r,c){return shape.every(([x,y])=>r+y<SIZE&&c+x<SIZE&&r+y>=0&&c+x>=0&&!board[r+y][c+x]);}
function placeAt(r,c,pieceIndex=selected){
 if(paused||hammerMode||pieceIndex<0||!pieces[pieceIndex])return;
 const piece=pieces[pieceIndex];
 if(!canPlace(piece.shape,r,c)){showModal('Chưa đặt được!','Khối đang chạm vào ô đã có hoặc vượt khỏi bàn. Hãy chọn vị trí khác nhé.');return;}
 lastMoveSnapshot={board:board.map(row=>[...row]),score,pieces:pieces.map(item=>item?{shape:item.shape.map(cell=>[...cell]),color:item.color}:null)};
 piece.shape.forEach(([x,y])=>board[r+y][c+x]=piece.color);
 score+=piece.shape.length;
 const rows=[],cols=[];
 for(let i=0;i<SIZE;i++){if(board[i].every(Boolean))rows.push(i);if(board.every(row=>row[i]))cols.push(i);}
 rows.forEach(row=>board[row].fill(null));
 cols.forEach(col=>board.forEach(row=>row[col]=null));
 const clearedLines=rows.length+cols.length;
 playBlockSound(piece.shape.length);
 if(clearedLines){
  score+=clearedLines*10+Math.max(0,rows.length*cols.length)*5;
  const coinReward=clearedLines*2+Math.max(0,clearedLines-1)*2;
  setCoins(coins+coinReward);
  showCoinToast(coinReward);
  playClearSound(clearedLines);
 }
 scoreEl.textContent=score;
 if(score>best){best=score;bestEl.textContent=best;localStorage.setItem('duckBest',best);}
 updateAchievementProgress({placements:1,clearedLines});
 pieces[pieceIndex]=null;
 selected=-1;
 if(pieces.every(item=>!item))newPieces();else renderTray();
 renderBoard();
 saveGame();
 if(!pieces.some(item=>item&&hasAnyFit(item.shape))){
  localStorage.removeItem('duckActiveGame');
  saveRunToLeaderboard();
  playEffect(180,.5);
  document.body.classList.add('game-over');
  showModal('HẾT ĐƯỜNG!','Điểm ván này: '+score+'. Ván mới sẽ tự bắt đầu sau 3 giây.');
  document.getElementById('modal').classList.add('game-over');
  restartTimer=setTimeout(()=>{restartTimer=null;closeModal();freshBoard();},3000);
 }
}
function hasAnyFit(shape){for(let r=0;r<SIZE;r++)for(let c=0;c<SIZE;c++)if(canPlace(shape,r,c))return true;return false;}
function showModal(title,msg){clearInterval(dailyCountdownTimer);dailyCountdownTimer=null;document.getElementById('modalTitle').textContent=title;document.getElementById('modalText').textContent=msg;document.getElementById('modalText').classList.remove('hidden');document.getElementById('statsDashboard').classList.add('hidden');document.getElementById('dailyDashboard').classList.add('hidden');document.getElementById('leaderboardDashboard').classList.add('hidden');document.getElementById('accountDashboard').classList.add('hidden');document.getElementById('shopDashboard').classList.add('hidden');document.getElementById('achievementsDashboard').classList.add('hidden');document.getElementById('settingsControls').classList.add('hidden');document.getElementById('dailyClaimBtn').classList.add('hidden');document.getElementById('modalOk').classList.remove('hidden');document.getElementById('modalOk').textContent='ĐÃ HIỂU';document.getElementById('modal').classList.remove('hidden');}
function showCoinShop(){showModal('CỬA HÀNG XU','');document.getElementById('modalText').classList.add('hidden');document.getElementById('modalOk').textContent='TIẾP TỤC CHƠI';document.getElementById('shopDashboard').classList.remove('hidden');renderCoinShop();}
function renderCoinShop(){
  const dashboard=document.getElementById('shopDashboard'),canReroll=pieces.some(Boolean)&&!paused,canHammer=board.some(row=>row.some(Boolean))&&!paused,canUndo=!!lastMoveSnapshot&&!paused,starterGift=localStorage.getItem('duckStarterPackPending')==='true';
  const consumables=SHOP_ITEMS.map(item=>{
    const count=inventory[item.id],canUse=item.id==='reroll'?canReroll:item.id==='hammer'?canHammer:canUndo;
    const action=count?`<button class="shop-action" data-shop-use="${item.id}" ${canUse?'':'disabled'}>${canUse?`DÙNG (${count})`:`${count} CÓ SẴN`}</button>`:`<button class="shop-action" data-shop-buy="${item.id}" ${coins>=item.price?'':'disabled'}>ĐỔI · ${item.price} 🪙</button>`;
    return `<article class="shop-item"><span class="shop-item-icon">${item.icon}</span><div class="shop-item-copy"><b>${item.name}</b><small>${item.description}</small><span class="shop-stock">${count} trong túi</span></div>${action}</article>`;
  }).join('');
  const themes=BOARD_THEMES.map(theme=>{
    const owned=inventory.themes.includes(theme.id),selected=localStorage.getItem('duckBoardTheme')===theme.id;
    return `<article class="shop-item shop-theme"><span class="shop-item-icon">${theme.icon}</span><div class="shop-item-copy"><b>${theme.name}</b><small>Đổi màu bàn chơi vĩnh viễn.</small><span class="shop-stock">${selected?'ĐANG DÙNG':owned?'ĐÃ SỞ HỮU':`${theme.price} xu · mở khóa một lần`}</span></div>${owned?`<button class="shop-action" data-shop-theme="${theme.id}" ${selected?'disabled':''}>${selected?'ĐANG DÙNG':'TRANG BỊ'}</button>`:`<button class="shop-action" data-shop-buy-theme="${theme.id}" ${coins>=theme.price?'':'disabled'}>MỞ KHÓA · ${theme.price} 🪙</button>`}</article>`;
  }).join('');
  dashboard.innerHTML=`<div class="shop-wallet"><span>🪙</span><div><small>SỐ DƯ CỦA BẠN</small><b>${coins.toLocaleString('vi-VN')} xu</b></div><small>Xu miễn phí: nhận quà ngày hoặc xóa hàng/cột. Không nạp tiền.</small></div>${starterGift?'<div class="shop-starter-gift">🎉 QUÀ TÂN THỦ: ĐÃ TẶNG 2 MÓN MỖI LOẠI TRỢ GIÚP!</div>':''}<div class="shop-section-title">⚡ TRỢ GIÚP TRONG VÁN</div><div class="shop-items">${consumables}</div><div class="shop-section-title">🎨 BÀN CHƠI CỦA BẠN</div><div class="shop-items">${themes}</div><div class="shop-note">Toàn bộ nội dung chỉ dùng xu kiếm miễn phí trong game. Không có nạp xu hay thanh toán thật.</div>`;
  if(starterGift)localStorage.removeItem('duckStarterPackPending');
  dashboard.querySelectorAll('[data-shop-buy]').forEach(button=>button.onclick=()=>buyShopItem(button.dataset.shopBuy));
  dashboard.querySelectorAll('[data-shop-use]').forEach(button=>button.onclick=()=>useShopItem(button.dataset.shopUse));
  dashboard.querySelectorAll('[data-shop-buy-theme]').forEach(button=>button.onclick=()=>buyBoardTheme(button.dataset.shopBuyTheme));
  dashboard.querySelectorAll('[data-shop-theme]').forEach(button=>button.onclick=()=>{applyBoardTheme(button.dataset.shopTheme);renderCoinShop();playEffect(880,.12);});
}
function buyShopItem(id){const item=SHOP_ITEMS.find(entry=>entry.id===id);if(!item)return;if(coins<item.price){showModal('CHƯA ĐỦ XU',`Bạn cần ${item.price} xu để mua ${item.name}.`);return;}setCoins(coins-item.price);inventory[id]++;saveShopInventory();playEffect(740,.12);showCoinShop();}
function buyBoardTheme(id){const theme=BOARD_THEMES.find(entry=>entry.id===id);if(!theme||inventory.themes.includes(id))return;if(coins<theme.price){showModal('CHƯA ĐỦ XU',`Bạn cần ${theme.price} xu để mở khóa bàn ${theme.name}.`);return;}setCoins(coins-theme.price);inventory.themes.push(id);saveShopInventory();applyBoardTheme(id);playEffect(1040,.2);showCoinShop();}
function useShopItem(id,returnToShop=true){if(!inventory[id])return;if(paused){if(returnToShop)showModal('VÁN ĐANG TẠM DỪNG','Hãy tiếp tục ván chơi rồi dùng vật phẩm nhé.');return;}if(id==='undo'){if(!lastMoveSnapshot)return;board=lastMoveSnapshot.board.map(row=>[...row]);pieces=lastMoveSnapshot.pieces.map(piece=>piece?{shape:piece.shape.map(cell=>[...cell]),color:piece.color}:null);score=lastMoveSnapshot.score;lastMoveSnapshot=null;scoreEl.textContent=score;inventory.undo--;saveShopInventory();renderBoard();renderTray();saveGame();playEffect(620,.16);if(returnToShop)showCoinShop();return;}if(id==='reroll'){if(!pieces.some(Boolean))return;pieces=pieces.map(piece=>piece?{shape:randomShape(),color:COLORS[Math.floor(Math.random()*COLORS.length)]}:null);selected=-1;inventory.reroll--;saveShopInventory();renderTray();saveGame();playEffect(780,.15);if(returnToShop)showCoinShop();return;}if(id==='hammer'){if(!board.some(row=>row.some(Boolean)))return;hammerMode=true;document.getElementById('cancelHammerBtn').classList.remove('hidden');document.querySelector('.board-heading .sub').textContent='🔨 Phá vùng 3×3 quanh ô chọn';document.querySelector('.board-heading .sub').classList.add('hammer-prompt');document.getElementById('shopDashboard').classList.add('hidden');document.getElementById('modal').classList.add('hidden');renderLobbyPowerups();return;}}
function cancelHammerMode(){hammerMode=false;const cancelButton=document.getElementById('cancelHammerBtn'),status=document.querySelector('.board-heading .sub');if(cancelButton)cancelButton.classList.add('hidden');if(status){status.textContent='8 × 8';status.classList.remove('hammer-prompt');}renderLobbyPowerups();}
function clearCell(row,col){if(paused||!hammerMode)return;if(!board[row][col]){showModal('CHỌN Ô ĐÃ LẤP','Hãy chọn ô có khối làm tâm búa. Búa sẽ phá các ô trong vùng 3×3 quanh đó.');return;}let removed=0;for(let r=Math.max(0,row-HAMMER_RADIUS);r<=Math.min(SIZE-1,row+HAMMER_RADIUS);r++)for(let c=Math.max(0,col-HAMMER_RADIUS);c<=Math.min(SIZE-1,col+HAMMER_RADIUS);c++){if(board[r][c]){board[r][c]=null;removed++;}}if(!removed)return;inventory.hammer--;lastMoveSnapshot=null;saveShopInventory();cancelHammerMode();renderBoard();saveGame();playEffect(180,.2);}
function updateHammerPreview(row,col){clearHammerPreview();if(!board[row][col])return;for(let r=Math.max(0,row-HAMMER_RADIUS);r<=Math.min(SIZE-1,row+HAMMER_RADIUS);r++)for(let c=Math.max(0,col-HAMMER_RADIUS);c<=Math.min(SIZE-1,col+HAMMER_RADIUS);c++)boardEl.querySelector(`[data-row="${r}"][data-col="${c}"]`)?.classList.add('hammer-blast');boardEl.querySelector(`[data-row="${row}"][data-col="${col}"]`)?.classList.add('hammer-target');}
function clearHammerPreview(){boardEl.querySelectorAll('.hammer-blast,.hammer-target').forEach(cell=>cell.classList.remove('hammer-blast','hammer-target'));}
function closeModal(){clearInterval(dailyCountdownTimer);dailyCountdownTimer=null;const modal=document.getElementById('modal');modal.classList.add('hidden');modal.classList.remove('game-over');document.body.classList.remove('game-over');}
function supabaseUrl(path){return `${SUPABASE_CONFIG.url.replace(/\/+$/,'')}${path}`;}
async function supabaseRequest(path,{method='GET',body,authenticated=false}={}){if(!SUPABASE_CONFIG?.url||!SUPABASE_CONFIG?.publishableKey)throw new Error('Chưa cấu hình kết nối Supabase.');const headers={'apikey':SUPABASE_CONFIG.publishableKey};if(body!==undefined)headers['Content-Type']='application/json';if(authenticated){await ensureAuthSession();headers.Authorization=`Bearer ${authSession.access_token}`;}const response=await fetch(supabaseUrl(path),{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();let result=null;if(text){try{result=JSON.parse(text);}catch{result={message:text};}}if(!response.ok)throw new Error(result?.msg||result?.message||result?.error_description||`Lỗi kết nối Supabase (${response.status}).`);return result;}
function storeAuthSession(session){if(!session?.access_token||!session?.refresh_token)throw new Error('Supabase không trả về phiên đăng nhập hợp lệ.');authSession={...session,expires_at:session.expires_at||Math.floor(Date.now()/1000)+(Number(session.expires_in)||3600)};localStorage.setItem(AUTH_STORAGE_KEY,JSON.stringify(authSession));updateAccountButton();}
function clearAuthSession(){authSession=null;localStorage.removeItem(AUTH_STORAGE_KEY);updateAccountButton();}
async function refreshAuthSession(){if(!authSession?.refresh_token)throw new Error('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.');if(!authRefreshPromise){authRefreshPromise=(async()=>{try{const result=await supabaseRequest('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:authSession.refresh_token}});storeAuthSession(result);return authSession;}catch(error){clearAuthSession();throw error;}finally{authRefreshPromise=null;}})();}return authRefreshPromise;}
async function ensureAuthSession(){if(!authSession)throw new Error('Hãy đăng nhập để dùng bảng xếp hạng online.');if(Number(authSession.expires_at)>Math.floor(Date.now()/1000)+60)return authSession;return refreshAuthSession();}
function authNickname(){const name=authSession?.user?.user_metadata?.display_name;return typeof name==='string'&&name.trim()?name.trim():'Người chơi';}
function updateAccountButton(){const button=document.getElementById('accountBtn');if(!button)return;button.textContent=authSession?`👤 ${authNickname()}`:'👤 Đăng nhập';button.title=authSession?'Đang đăng nhập':'Đăng ký hoặc đăng nhập';}
function setAccountStatus(message,isError=false,dashboard=document.getElementById('accountDashboard')){const status=dashboard?.querySelector('.account-status');if(!status)return;status.textContent=message;status.classList.toggle('error',isError);status.classList.remove('hidden');}
function openAccount(){showModal(authSession?'TÀI KHOẢN':'ĐĂNG NHẬP / ĐĂNG KÝ','');document.getElementById('modalText').classList.add('hidden');document.getElementById('accountDashboard').classList.remove('hidden');renderAccountDashboard();}
function renderAccountDashboard(dashboard=document.getElementById('accountDashboard')){if(!dashboard)return;if(authSession){dashboard.innerHTML=`<div class="account-status" role="status">Đang đăng nhập với biệt danh <b>${escapeHtml(authNickname())}</b>. Email của bạn không hiển thị trên bảng xếp hạng.</div><button class="secondary-btn" data-account-signout>ĐĂNG XUẤT</button>`;dashboard.querySelector('[data-account-signout]').onclick=async()=>{try{if(authSession)await supabaseRequest('/auth/v1/logout',{method:'POST',authenticated:true});clearAuthSession();renderAccountDashboard(dashboard);setAccountStatus('Đã đăng xuất khỏi tài khoản.',false,dashboard);}catch(error){console.error('Không thể đăng xuất khỏi Supabase.',error);setAccountStatus(error.message,true,dashboard);}};return;}dashboard.innerHTML=`<div class="account-status hidden" role="status"></div><form class="account-form" data-account-form><label>Biệt danh <input name="nickname" type="text" minlength="2" maxlength="24" autocomplete="nickname" placeholder="Tên sẽ hiện trên bảng xếp hạng"></label><label>Email <input name="email" type="email" required autocomplete="email" placeholder="ban@email.com"></label><label>Mật khẩu <input name="password" type="password" required minlength="6" autocomplete="current-password" placeholder="Ít nhất 6 ký tự"></label><div class="account-actions"><button class="play-btn compact" type="submit">ĐĂNG NHẬP</button><button class="secondary-btn" data-account-signup type="button">TẠO TÀI KHOẢN</button></div><small>Email chỉ dùng đăng nhập và không xuất hiện công khai.</small></form>`;dashboard.querySelector('[data-account-form]').onsubmit=event=>{event.preventDefault();void signInAccount(dashboard);};dashboard.querySelector('[data-account-signup]').onclick=()=>{void signUpAccount(dashboard);};}
async function signUpAccount(dashboard){const form=dashboard.querySelector('[data-account-form]'),nickname=form.elements.nickname.value.trim(),email=form.elements.email.value.trim(),password=form.elements.password.value;if(nickname.length<2||nickname.length>24){setAccountStatus('Biệt danh cần từ 2 đến 24 ký tự.',true,dashboard);return;}if(!form.reportValidity())return;try{const result=await supabaseRequest('/auth/v1/signup',{method:'POST',body:{email,password,data:{display_name:nickname}}});if(result.access_token){storeAuthSession(result);renderAccountDashboard(dashboard);setAccountStatus('Tạo tài khoản thành công. Điểm các ván tiếp theo sẽ được gửi lên bảng xếp hạng.',false,dashboard);}else{setAccountStatus('Đã tạo tài khoản. Hãy kiểm tra email để xác nhận, sau đó đăng nhập.',false,dashboard);}}catch(error){console.error('Không thể đăng ký Supabase.',error);setAccountStatus(error.message,true,dashboard);}}
async function signInAccount(dashboard){const form=dashboard.querySelector('[data-account-form]');if(!form.reportValidity())return;const email=form.elements.email.value.trim(),password=form.elements.password.value;try{const result=await supabaseRequest('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});storeAuthSession(result);renderAccountDashboard(dashboard);setAccountStatus('Đăng nhập thành công. Điểm các ván tiếp theo sẽ được gửi lên bảng xếp hạng.',false,dashboard);}catch(error){console.error('Không thể đăng nhập Supabase.',error);setAccountStatus(error.message,true,dashboard);}}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
async function loadOnlineLeaderboard(){const dashboard=document.getElementById('leaderboardDashboard');dashboard.innerHTML='<div class="leaderboard-empty"><span>⏳</span><b>Đang tải bảng xếp hạng...</b></div>';try{const entries=await supabaseRequest('/rest/v1/rpc/get_duck_min_quan_leaderboard',{method:'POST',body:{}});if(!Array.isArray(entries))throw new Error('Dữ liệu bảng xếp hạng không đúng định dạng.');renderOnlineLeaderboard(entries);}catch(error){console.error('Không thể tải bảng xếp hạng online.',error);const missingFunction=error.message.includes('Could not find the function public.get_duck_min_quan_leaderboard'),message=missingFunction?'Supabase chưa được cài đặt bảng xếp hạng. Làm theo hướng dẫn ngay bên dưới rồi nhấn thử lại.':`${error.message} Kiểm tra kết nối mạng hoặc cấu hình SQL Supabase.`;dashboard.innerHTML=`<div class="leaderboard-empty"><span>⚠️</span><b>Chưa tải được bảng xếp hạng online</b><small>${escapeHtml(message)}</small>${missingFunction?'<details class="leaderboard-setup-help"><summary>HƯỚNG DẪN CÀI ĐẶT NGAY TRONG GAME</summary><ol><li>Mở Supabase project của game và vào <b>SQL Editor</b>.</li><li>Mở tệp <b>supabase-setup.sql</b> trong thư mục game, sao chép toàn bộ nội dung.</li><li>Dán vào SQL Editor rồi nhấn <b>Run</b>.</li><li>Chờ lệnh chạy thành công, quay lại đây và nhấn <b>THỬ LẠI</b>.</li></ol></details>':''}<button id="leaderboardRetryBtn" class="secondary-btn">THỬ LẠI</button></div>`;document.getElementById('leaderboardRetryBtn').onclick=()=>{void loadOnlineLeaderboard();}}}
function renderOnlineLeaderboard(entries){const dashboard=document.getElementById('leaderboardDashboard'),topThree=entries.slice(0,3),medals=['🥇','🥈','🥉'];const podium=[1,0,2].map(position=>{const entry=topThree[position];return entry?`<div class="podium-player rank-${position+1}"><div class="podium-avatar">${position===0?'👑':'🦆'}</div><b>${escapeHtml(entry.nickname)}</b><small>${Number(entry.score).toLocaleString('vi-VN')} điểm</small><span class="podium-medal">${medals[position]}</span><div class="podium-step"><strong>${position+1}</strong></div></div>`:`<div class="podium-player rank-${position+1} vacant"><div class="podium-avatar">✦</div><b>---</b><small>Chưa có điểm</small><span class="podium-medal">${medals[position]}</span><div class="podium-step"><strong>${position+1}</strong></div></div>`;}).join('');const rows=entries.slice(3).map((entry,index)=>`<div class="leaderboard-row"><span class="leaderboard-rank">${String(index+4).padStart(2,'0')}</span><span class="leaderboard-player-icon">🦆</span><span class="leaderboard-player"><b>${escapeHtml(entry.nickname)}</b><small>${new Date(entry.updated_at).toLocaleDateString('vi-VN')}</small></span><strong class="leaderboard-score">${Number(entry.score).toLocaleString('vi-VN')} <small>điểm</small></strong></div>`).join('');dashboard.innerHTML=`<div class="leaderboard-banner"><div class="leaderboard-trophy">🏆</div><div><strong>TOP 100 TOÀN SERVER</strong><span>Điểm cao nhất của từng người chơi</span></div><div class="leaderboard-total"><b>${entries.length}</b><small>NGƯỜI CHƠI</small></div></div><div class="leaderboard-podium">${podium}</div>${entries.length>3?`<div class="leaderboard-list-heading"><b>🏅 BẢNG VINH DANH</b><span>HẠNG 4–${entries.length}</span></div><div class="leaderboard-list">${rows}</div>`:''}<div class="leaderboard-local-note">${authSession?`Đang đăng nhập: ${escapeHtml(authNickname())} · Kỷ lục của bạn tự cập nhật sau mỗi ván`:'Đăng nhập để tên và điểm của bạn xuất hiện trên bảng toàn server'} <button id="leaderboardAccountBtn" class="leaderboard-account-link">${authSession?'TÀI KHOẢN':'ĐĂNG NHẬP'}</button></div>`;document.getElementById('leaderboardAccountBtn').onclick=openAccount;}
async function submitOnlineScore(runScore){if(!authSession)return 'Đăng nhập để đưa điểm lên bảng xếp hạng toàn server.';try{await supabaseRequest('/rest/v1/rpc/submit_duck_min_quan_score',{method:'POST',body:{p_score:Math.max(0,Math.floor(runScore)),p_nickname:authNickname()},authenticated:true});return 'Đã lưu điểm lên bảng xếp hạng toàn server!';}catch(error){console.error('Không thể gửi điểm lên bảng xếp hạng.',error);return `Chưa gửi được điểm online: ${error.message}`;}}
function readLeaderboard(){try{const entries=JSON.parse(localStorage.getItem('duckLeaderboard')||'[]');if(!Array.isArray(entries))throw new TypeError('Bảng điểm đã lưu không đúng định dạng.');return entries.filter(entry=>entry&&Number.isFinite(entry.score)&&typeof entry.date==='string').sort((a,b)=>b.score-a.score).slice(0,10);}catch(error){console.error('Không thể đọc bảng xếp hạng đã lưu.',error);return [];}}
function saveRunToLeaderboard(){const runScore=score,entries=readLeaderboard();entries.push({score:runScore,date:new Date().toLocaleDateString('vi-VN')});entries.sort((a,b)=>b.score-a.score);localStorage.setItem('duckLeaderboard',JSON.stringify(entries.slice(0,10)));localStorage.setItem('duckGames',(Number(localStorage.getItem('duckGames'))||0)+1);localStorage.setItem('duckTotalPoints',(Number(localStorage.getItem('duckTotalPoints'))||0)+runScore);checkAchievementUnlocks();void submitOnlineScore(runScore).then(message=>{if(document.body.classList.contains('game-over'))document.getElementById('modalText').textContent=`Điểm ván này: ${runScore}. ${message}`;});}
function showLeaderboard(){showModal('BẢNG XẾP HẠNG','');document.getElementById('modalText').classList.add('hidden');document.getElementById('modalOk').textContent='ĐÓNG';document.getElementById('leaderboardDashboard').classList.remove('hidden');void loadOnlineLeaderboard();}
function localDate(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function getCurrentStreak(){const streak=Number(localStorage.getItem('duckDailyStreak'))||0,lastClaim=localStorage.getItem('duckDailyDate');const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);return lastClaim===localDate()||lastClaim===localDate(yesterday)?streak:0;}
function showStatistics(){const games=Number(localStorage.getItem('duckGames'))||0,total=Number(localStorage.getItem('duckTotalPoints'))||0,average=games?Math.round(total/games):0,streak=getCurrentStreak(),leaderboard=readLeaderboard(),topScore=leaderboard[0]?.score||0,progress=streak?streak%7||7:0,dashboard=document.getElementById('statsDashboard');document.getElementById('shopDashboard').classList.add('hidden');document.getElementById('modalTitle').textContent='THỐNG KÊ';document.getElementById('modalText').classList.add('hidden');document.getElementById('settingsControls').classList.add('hidden');document.getElementById('dailyClaimBtn').classList.add('hidden');document.getElementById('modalOk').classList.remove('hidden');dashboard.innerHTML=`<div class="stats-hero"><span>🏆</span><div><small>ĐIỂM VÁN NÀY</small><strong>${score.toLocaleString('vi-VN')}</strong></div><span class="stats-hero-badge">BEST<br>${best.toLocaleString('vi-VN')}</span></div><div class="stats-grid"><div class="stats-tile"><span>👑</span><small>KỶ LỤC</small><b>${best.toLocaleString('vi-VN')}</b></div><div class="stats-tile"><span>🪙</span><small>ĐỒNG XU</small><b>${coins.toLocaleString('vi-VN')}</b></div><div class="stats-tile"><span>🎮</span><small>VÁN ĐÃ CHƠI</small><b>${games}</b></div><div class="stats-tile"><span>📈</span><small>ĐIỂM TRUNG BÌNH</small><b>${average.toLocaleString('vi-VN')}</b></div></div><div class="stats-streak"><div><span>🔥</span><b>Chuỗi điểm danh</b><strong>${streak} ngày</strong></div><div class="streak-track">${Array.from({length:7},(_,i)=>`<span class="${i<progress?'earned':''}">${i<progress?'✓':i+1}</span>`).join('')}</div><small>${streak?`Còn ${progress===7?7:7-progress} ngày đến mốc tuần tiếp theo`:'Nhận quà hằng ngày để bắt đầu streak!'}</small></div><div class="stats-footer">Tổng điểm đã ghi nhận: <b>${total.toLocaleString('vi-VN')}</b> · Điểm cao nhất bảng: <b>${topScore.toLocaleString('vi-VN')}</b></div>`;dashboard.classList.remove('hidden');document.getElementById('modal').classList.remove('hidden');}
function getDailyReward(){const today=localDate(),lastClaim=localStorage.getItem('duckDailyDate'),streak=Number(localStorage.getItem('duckDailyStreak'))||0;if(today===lastClaim)return {claimed:true,streak,points:0,coins:0,bonusCoins:0};const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);const nextStreak=lastClaim===localDate(yesterday)?streak+1:1;return {claimed:false,streak:nextStreak,points:Math.min(100,25+(nextStreak-1)*5),coins:Math.min(50,10+(nextStreak-1)*2),bonusCoins:nextStreak%7===0?30:0};}
function readDailyChest(){try{const saved=localStorage.getItem('duckDailyChest');if(!saved&&localStorage.getItem('duckDailyDate')===localDate()){const streak=Number(localStorage.getItem('duckDailyStreak'))||0,bonusCoins=streak>0&&streak%7===0?30:0,chest={date:localDate(),remaining:bonusCoins?2:1,items:[],coins:bonusCoins,bonusCoins,points:0};if(bonusCoins)setCoins(coins+bonusCoins);localStorage.setItem('duckDailyChest',JSON.stringify(chest));return chest;}const chest=JSON.parse(saved||'null');return chest&&chest.date===localDate()&&Number.isInteger(chest.remaining)&&Array.isArray(chest.items)?chest:null;}catch(error){console.error('Không thể đọc rương quà hằng ngày.',error);return null;}}
function selectDailyChestItem(id){const item=SHOP_ITEMS.find(entry=>entry.id===id),chest=readDailyChest();if(!item||!chest||chest.remaining<1)return;inventory[id]++;saveShopInventory();chest.remaining--;chest.items.push(id);localStorage.setItem('duckDailyChest',JSON.stringify(chest));playTreasureSound();showDailyReward();}
function playTreasureSound(){if(!soundEnabled)return;const context=getAudioContext();if(!context)return;const now=context.currentTime;[587,784,988,1318].forEach((frequency,index)=>{const start=now+index*.085,oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);gain.gain.setValueAtTime(.001,start);gain.gain.linearRampToValueAtTime(.045,start+.018);gain.gain.exponentialRampToValueAtTime(.001,start+.28);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+.3);});}
function updateDailyCountdown(){const now=new Date(),tomorrow=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1),remaining=Math.max(0,tomorrow-now),hours=String(Math.floor(remaining/3600000)).padStart(2,'0'),minutes=String(Math.floor(remaining%3600000/60000)).padStart(2,'0'),seconds=String(Math.floor(remaining%60000/1000)).padStart(2,'0'),timer=document.getElementById('dailyCountdown');if(timer)timer.textContent=`${hours}:${minutes}:${seconds}`;}
function showDailyReward(){const reward=getDailyReward(),streak=reward.streak,chest=readDailyChest(),progress=reward.claimed?Math.max(1,streak%7||7):Math.max(0,(streak-1)%7),nextStreak=reward.claimed?streak+1:streak,tomorrowPoints=Math.min(100,25+(nextStreak-1)*5),tomorrowCoins=Math.min(50,10+(nextStreak-1)*2),dashboard=document.getElementById('dailyDashboard'),chestChoices=SHOP_ITEMS.map(item=>`<button class="daily-chest-choice" data-daily-item="${item.id}"><span>${item.icon}</span><b>${item.name}</b><small>+1 vào túi</small></button>`).join(''),earnedItems=chest?.items.map(id=>SHOP_ITEMS.find(item=>item.id===id)).filter(Boolean)||[];showModal('QUÀ HẰNG NGÀY','');document.getElementById('modalText').classList.add('hidden');const chestPanel=reward.claimed?chest?.remaining?`<section class="daily-chest-panel"><div class="daily-chest-heading"><span class="chest-open-icon">🎁</span><div><b>${chest.remaining===2?'RƯƠNG MỐC TUẦN!':'RƯƠNG BÍ ẨN ĐÃ MỞ!'}</b><small>Chọn ${chest.remaining} vật phẩm miễn phí</small></div></div><div class="daily-chest-choices">${chestChoices}</div>${earnedItems.length?`<div class="daily-chest-earned">Đã nhận: ${earnedItems.map(item=>`${item.icon} ${item.name}`).join(' · ')}</div>`:''}</section>`:chest?`<section class="daily-chest-panel daily-chest-complete"><div class="daily-chest-heading"><span class="chest-open-icon">✨</span><div><b>RƯƠNG ĐÃ MỞ!</b><small>Vật phẩm đã được thêm vào túi của bạn.</small></div></div><div class="daily-chest-earned">${earnedItems.map(item=>`${item.icon} ${item.name}`).join(' · ')}</div><div class="daily-chest-earned">Hôm nay: +${chest.coins} xu${chest.bonusCoins?` (gồm +${chest.bonusCoins} xu mốc tuần)`:''} · +${chest.points} điểm</div></section>`:'' :`<section class="daily-chest-panel daily-chest-locked"><div class="daily-chest-heading"><span class="chest-open-icon">🎁</span><div><b>${reward.bonusCoins?'RƯƠNG MỐC TUẦN ĐANG CHỜ!':'CÓ THÊM RƯƠNG BÍ ẨN!'}</b><small>Sau khi nhận xu, chọn miễn phí ${reward.bonusCoins?'2 vật phẩm trợ giúp':'1 vật phẩm trợ giúp'}.</small></div></div><div class="daily-chest-preview">${SHOP_ITEMS.map(item=>`<span title="${item.name}">${item.icon}</span>`).join('')}<b>${reward.bonusCoins?'+30 xu thưởng tuần':''}</b></div></section>`;dashboard.innerHTML=`<div class="daily-hero ${reward.claimed?'claimed':''}"><div class="daily-gift-orbit"><span class="daily-spark spark-one">✦</span><span class="daily-spark spark-two">✧</span><span class="daily-gift">${reward.claimed?'🎉':'🎁'}</span></div><div class="daily-hero-copy"><strong>${reward.claimed?'ĐÃ ĐIỂM DANH!':'QUÀ ĐANG CHỜ!'}</strong><span>${reward.claimed?'Hôm nay bạn đã nhận quà':'Nhận quà và giữ lửa streak'}</span></div><div class="daily-streak-pill">🔥 <b>${streak}</b><small>NGÀY</small></div></div><div class="daily-reward-cards"><div class="daily-reward-card points"><span>⭐</span><div><small>${reward.claimed?'NGÀY MAI':'ĐIỂM THƯỞNG'}</small><b>+${reward.claimed?tomorrowPoints:reward.points} điểm</b></div></div><div class="daily-reward-card coins"><span>🪙</span><div><small>${reward.claimed?'NGÀY MAI':'QUÀ HÔM NAY'}</small><b>+${reward.claimed?tomorrowCoins:reward.coins} xu</b></div></div></div>${chestPanel}<section class="daily-calendar"><div class="daily-calendar-heading"><b>🏆 HÀNH TRÌNH 7 NGÀY</b><span>${progress}/7</span></div><div class="daily-progress"><span style="width:${progress/7*100}%"></span></div><div class="daily-days">${Array.from({length:7},(_,i)=>`<div class="daily-day ${i<progress?'complete':''} ${!reward.claimed&&i===progress?'today':''}"><span>${i<progress?'✓':i===progress&&!reward.claimed?'🎁':i===6?'👑':'•'}</span><small>NGÀY ${i+1}</small></div>`).join('')}</div><div class="daily-milestone">${reward.bonusCoins||reward.claimed&&progress===7?'🎉':'👑'} <span>${reward.bonusCoins?'Mốc 7 ngày: nhận +30 xu và chọn 2 món trong rương!':reward.claimed&&progress===7?'Tuyệt vời! Mốc tuần đã mở khóa.':'Đủ 7 ngày liên tiếp sẽ mở rương mốc tuần!'}</span></div></section><div class="daily-next"><span>${reward.claimed?'⏳':'✨'}</span><div><b>${reward.claimed?'QUÀ TIẾP THEO MỞ SAU':'NHẬN NGAY HÔM NAY'}</b><strong id="dailyCountdown">--:--:--</strong></div><small>${reward.claimed?'Quay lại ngày mai để tiếp tục chuỗi':'Điểm thưởng cộng vào điểm ván hiện tại'}</small></div>`;dashboard.classList.remove('hidden');document.getElementById('modalOk').textContent=reward.claimed?'ĐÓNG':'ĐỂ SAU';if(reward.claimed){dashboard.querySelectorAll('[data-daily-item]').forEach(button=>button.onclick=()=>selectDailyChestItem(button.dataset.dailyItem));updateDailyCountdown();dailyCountdownTimer=setInterval(updateDailyCountdown,1000);}else{const claimButton=document.getElementById('dailyClaimBtn');claimButton.textContent=reward.bonusCoins?'MỞ RƯƠNG MỐC TUẦN':'MỞ RƯƠNG & NHẬN QUÀ';claimButton.classList.remove('hidden');}}
function claimDailyReward(){const reward=getDailyReward();if(reward.claimed){showDailyReward();return;}const totalCoins=reward.coins+reward.bonusCoins;score+=reward.points;setCoins(coins+totalCoins);scoreEl.textContent=score;if(score>best){best=score;bestEl.textContent=best;localStorage.setItem('duckBest',best);}localStorage.setItem('duckDailyDate',localDate());localStorage.setItem('duckDailyStreak',reward.streak);localStorage.setItem('duckDailyChest',JSON.stringify({date:localDate(),remaining:reward.bonusCoins?2:1,items:[],coins:totalCoins,bonusCoins:reward.bonusCoins,points:reward.points}));saveGame();playTreasureSound();showDailyReward();}
function getAudioContext(){const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)return null;if(!audioContext)audioContext=new AudioContextClass();return audioContext;}
function playTone(frequency,duration,volume=.04){const context=getAudioContext();if(!context)return;const oscillator=context.createOscillator(),gain=context.createGain();oscillator.frequency.value=frequency;oscillator.type='sine';gain.gain.setValueAtTime(volume,context.currentTime);gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+duration);oscillator.connect(gain);gain.connect(context.destination);oscillator.start();oscillator.stop(context.currentTime+duration);}
function playEffect(frequency,duration){if(soundEnabled)playTone(frequency,duration);}
function playBlockSound(blockCount){if(!soundEnabled)return;const context=getAudioContext();if(!context)return;const now=context.currentTime,pitch=360+Math.min(blockCount,6)*22;[[pitch*1.35,.014,.075,'sine'],[pitch,.035,.13,'triangle']].forEach(([frequency,volume,duration,type])=>{const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type=type;oscillator.frequency.setValueAtTime(frequency,now);oscillator.frequency.exponentialRampToValueAtTime(Math.max(100,frequency*.72),now+duration);gain.gain.setValueAtTime(.001,now);gain.gain.linearRampToValueAtTime(volume,now+.006);gain.gain.exponentialRampToValueAtTime(.001,now+duration);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(now);oscillator.stop(now+duration+.01);});}
function playClearSound(lineCount){if(!soundEnabled)return;const context=getAudioContext();if(!context)return;const now=context.currentTime,notes=lineCount>=3?[523,659,784,988,1175,1568]:lineCount===2?[587,740,880,1175]:[659,880,1175];notes.forEach((frequency,index)=>{const start=now+index*.085,oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='triangle';oscillator.frequency.setValueAtTime(frequency,start);gain.gain.setValueAtTime(.001,start);gain.gain.linearRampToValueAtTime(.055,start+.018);gain.gain.exponentialRampToValueAtTime(.001,start+.24);oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+.25);});}
function updateAudioButtons(){const soundIcon=soundEnabled?'🔊':'🔇',musicIcon=musicEnabled?'♫':'♪̸';document.getElementById('soundBtn').textContent=soundIcon;document.getElementById('musicBtn').textContent=musicIcon;document.getElementById('modalSoundToggle').textContent=`Âm thanh: ${soundEnabled?'BẬT':'TẮT'}`;document.getElementById('modalMusicToggle').textContent=`Nhạc nền: ${musicEnabled?'BẬT':'TẮT'}`;}
function updateMusicVolume(value){const percentage=Math.min(100,Math.max(0,Number(value)));backgroundMusic.volume=percentage/100;localStorage.setItem('duckMusicVolume',String(backgroundMusic.volume));const slider=document.getElementById('musicVolumeSlider');slider.value=String(percentage);slider.style.setProperty('--music-volume-fill',`${percentage}%`);document.getElementById('musicVolumeValue').value=`${percentage}%`;}
function toggleSound(){soundEnabled=!soundEnabled;localStorage.setItem('duckSound',soundEnabled);updateAudioButtons();playEffect(660,.1);}
async function startBackgroundMusic(){try{await backgroundMusic.play();musicEnabled=true;updateAudioButtons();}catch(error){musicEnabled=false;updateAudioButtons();console.error('Không thể tự phát nhạc nền.',error);showModal('KHÔNG PHÁT ĐƯỢC NHẠC','Trình duyệt chưa cho phép phát nhạc. Hãy nhấn nút ♫ để bật nhạc khi đang chơi.');}}
async function toggleMusic(){if(musicEnabled){backgroundMusic.pause();musicEnabled=false;musicPreferred=false;localStorage.setItem('duckMusic','false');updateAudioButtons();return;}musicPreferred=true;localStorage.setItem('duckMusic','true');await startBackgroundMusic();}
updateAudioButtons();updateMusicVolume(Math.round(backgroundMusic.volume*100));
document.getElementById('newGameBtn').onclick=()=>{clearTimeout(restartTimer);restartTimer=null;closeModal();freshBoard();};
document.getElementById('saveExitBtn').onclick=saveAndExit;
document.getElementById('helpBtn').onclick=()=>showModal('CÁCH CHƠI','Kéo một khối từ khay vào vị trí muốn đặt trên bàn 8×8. Trên điện thoại, bạn cũng có thể chạm chọn khối rồi chạm vào bàn. Lấp đầy hàng ngang hoặc cột dọc để xóa và ghi điểm.');
document.getElementById('statsBtn').onclick=showStatistics;
document.getElementById('settingsBtn').onclick=()=>{showModal('CÀI ĐẶT','Bật hoặc tắt hiệu ứng âm thanh, nhạc nền và chỉnh âm lượng.');document.getElementById('settingsControls').classList.remove('hidden');};
document.getElementById('rankBtn').onclick=showLeaderboard;
document.getElementById('dailyBtn').onclick=showDailyReward;
document.getElementById('shopBtn').onclick=showCoinShop;
document.getElementById('achievementsBtn').onclick=showAchievements;
document.getElementById('accountBtn').onclick=openAccount;
document.getElementById('cancelHammerBtn').onclick=cancelHammerMode;
document.getElementById('exitBtn').onclick=saveAndExit;
document.getElementById('closeModal').onclick=closeModal;document.getElementById('modalOk').onclick=closeModal;
document.getElementById('soundBtn').onclick=toggleSound;document.getElementById('modalSoundToggle').onclick=toggleSound;
document.getElementById('musicBtn').onclick=()=>{toggleMusic();};document.getElementById('modalMusicToggle').onclick=()=>{toggleMusic();};
document.getElementById('musicVolumeSlider').oninput=event=>updateMusicVolume(event.target.value);
updateAccountButton();renderAccountDashboard(document.getElementById('welcomeAccountDashboard'));if(authSession)void ensureAuthSession().catch(error=>{console.error('Không thể khôi phục phiên Supabase.',error);});
document.getElementById('dailyClaimBtn').onclick=claimDailyReward;
document.getElementById('enterGameBtn').onclick=()=>{document.getElementById('welcomePage').hidden=true;const gameShell=document.querySelector('.game-shell');gameShell.removeAttribute('inert');gameShell.removeAttribute('aria-hidden');if(musicPreferred)void startBackgroundMusic();};
function loadImage(input,cb){input.addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const reader=new FileReader();reader.onload=()=>cb(reader.result);reader.readAsDataURL(f);});}
function applyAvatarImage(src){const card=document.querySelector('.duck-card');card.style.backgroundImage=`url(${src})`;card.style.backgroundSize='cover';card.style.backgroundPosition='center';card.classList.add('has-photo');document.getElementById('welcomeAvatarPreview').src=src;}
function applyBlockImage(src){blockImage=src;renderBoard();}
loadImage(document.getElementById('photoInput'),applyAvatarImage);
loadImage(document.getElementById('welcomePhotoInput'),applyAvatarImage);
loadImage(document.getElementById('blockPhotoInput'),applyBlockImage);
loadImage(document.getElementById('welcomeBlockPhotoInput'),applyBlockImage);
window.addEventListener('pagehide',saveGame);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveGame();});
applyBoardTheme();if(!restoreSavedGame())freshBoard();

function setAccountStatus(message,isError=false,dashboard=document.getElementById('accountDashboard'),actionLabel='',actionHandler=null){const status=dashboard?.querySelector('.account-status');if(!status)return;status.replaceChildren(document.createTextNode(message));status.classList.toggle('error',isError);status.classList.remove('hidden');if(actionLabel&&actionHandler){const action=document.createElement('button');action.type='button';action.className='secondary-btn account-status-action';action.dataset.actionLabel=actionLabel;action.textContent=actionLabel;action.onclick=actionHandler;status.appendChild(action);updateSignupButton();}}
function translateAuthError(error){const message=String(error?.message||''),lower=message.toLowerCase(),cooldownMatch=message.match(/after\s+(\d+)\s+seconds?/i);if(cooldownMatch||lower.includes('security purposes')||lower.includes('rate limit'))return {message:'Bạn vừa thử gửi yêu cầu quá nhiều lần. Hãy đợi một chút rồi thử lại.',waitSeconds:Math.max(1,Math.min(300,Number(cooldownMatch?.[1])||45))};if(lower.includes('invalid login credentials'))return {message:'Email hoặc mật khẩu không đúng. Kiểm tra lại thông tin; nếu quên mật khẩu, hãy dùng QUÊN MẬT KHẨU?'};if(lower.includes('email not confirmed'))return {message:'Tài khoản cũ chưa được xác nhận email. Hãy thử tạo lại bằng email chưa có tài khoản hoặc dùng tài khoản mới.'};if(lower.includes('user already registered'))return {message:'Email này đã có tài khoản. Chuyển sang tab ĐĂNG NHẬP để dùng email và mật khẩu đó.'};if(lower.includes('password should be at least')||lower.includes('weak_password'))return {message:'Mật khẩu chưa đủ mạnh hoặc chưa đạt độ dài tối thiểu của Supabase.'};if(lower.includes('invalid email'))return {message:'Địa chỉ email chưa đúng định dạng.'};return {message};}
function signupCooldownRemaining(){const retryAt=Number(localStorage.getItem(SIGNUP_COOLDOWN_KEY))||0;return Math.max(0,Math.ceil((retryAt-Date.now())/1000));}
function updateSignupButton(dashboard){const buttons=dashboard?[...dashboard.querySelectorAll('[data-account-signup]')]:[...document.querySelectorAll('[data-account-signup]')],resendButtons=[...document.querySelectorAll('.account-status-action')],remaining=signupCooldownRemaining();buttons.forEach(button=>{button.disabled=accountRequestPending||remaining>0;button.textContent=accountRequestPending?'ĐANG GỬI...':remaining?`ĐỢI ${remaining} GIÂY`:'ĐĂNG KÝ';});resendButtons.forEach(button=>{button.disabled=accountRequestPending||remaining>0;button.textContent=remaining?`GỬI LẠI EMAIL SAU ${remaining} GIÂY`:button.dataset.actionLabel;});}
function startSignupCooldown(seconds){const retryAt=Date.now()+seconds*1000;localStorage.setItem(SIGNUP_COOLDOWN_KEY,String(retryAt));if(signupCooldownTimer)clearInterval(signupCooldownTimer);updateSignupButton();signupCooldownTimer=setInterval(()=>{updateSignupButton();if(!signupCooldownRemaining()){clearInterval(signupCooldownTimer);signupCooldownTimer=null;localStorage.removeItem(SIGNUP_COOLDOWN_KEY);}},1000);}
function renderAccountDashboard(dashboard=document.getElementById('accountDashboard')){if(!dashboard)return;if(authSession){dashboard.innerHTML=`<div class="account-status" role="status">Đang đăng nhập với biệt danh <b>${escapeHtml(authNickname())}</b>. Email của bạn không hiển thị trên bảng xếp hạng.</div><button class="secondary-btn" data-account-signout>ĐĂNG XUẤT</button>`;dashboard.querySelector('[data-account-signout]').onclick=async()=>{try{if(authSession)await supabaseRequest('/auth/v1/logout',{method:'POST',authenticated:true});clearAuthSession();renderAccountDashboard(dashboard);setAccountStatus('Đã đăng xuất khỏi tài khoản.',false,dashboard);}catch(error){console.error('Không thể đăng xuất khỏi Supabase.',error);setAccountStatus(translateAuthError(error).message,true,dashboard);}};return;}dashboard.innerHTML=`<div class="account-status hidden" role="status"></div><form class="account-form" data-account-form><label>Biệt danh <input name="nickname" type="text" minlength="2" maxlength="24" autocomplete="nickname" placeholder="Tên sẽ hiện trên bảng xếp hạng"></label><label>Email <input name="email" type="email" required autocomplete="email" placeholder="ban@email.com"></label><label>Mật khẩu <input name="password" type="password" required minlength="6" autocomplete="current-password" placeholder="Ít nhất 6 ký tự"></label><div class="account-actions"><button class="play-btn compact" type="submit" data-account-login>ĐĂNG NHẬP</button><button class="secondary-btn" data-account-signup type="button">TẠO TÀI KHOẢN</button></div><small>Email chỉ dùng đăng nhập và không xuất hiện công khai.</small></form>`;dashboard.querySelector('[data-account-form]').onsubmit=event=>{event.preventDefault();void signInAccount(dashboard);};dashboard.querySelector('[data-account-signup]').onclick=()=>{void signUpAccount(dashboard);};updateSignupButton(dashboard);}
async function signUpAccount(dashboard){if(accountRequestPending)return;const form=dashboard.querySelector('[data-account-form]'),nickname=form.elements.nickname.value.trim(),email=form.elements.email.value.trim(),password=form.elements.password.value,remaining=signupCooldownRemaining();if(remaining){setAccountStatus(`Vui lòng đợi ${remaining} giây trước khi gửi yêu cầu đăng ký tiếp theo.`,true,dashboard);updateSignupButton(dashboard);return;}if(nickname.length<2||nickname.length>24){setAccountStatus('Biệt danh cần từ 2 đến 24 ký tự.',true,dashboard);return;}if(!form.reportValidity())return;accountRequestPending=true;updateSignupButton(dashboard);const loginButton=dashboard.querySelector('[data-account-login]');if(loginButton){loginButton.disabled=true;loginButton.textContent='ĐANG XỬ LÝ...';}try{const result=await supabaseRequest('/auth/v1/signup',{method:'POST',body:{email,password,data:{display_name:nickname}}});if(result.access_token){storeAuthSession(result);renderAccountDashboard(dashboard);setAccountStatus('Tạo tài khoản thành công. Điểm các ván tiếp theo sẽ được gửi lên bảng xếp hạng.',false,dashboard);}else{startSignupCooldown(45,dashboard);setAccountStatus('Nếu email này chưa đăng ký, Supabase đã gửi thư xác nhận. Kiểm tra hộp thư và thư mục spam; nếu đã có tài khoản, hãy đăng nhập.',false,dashboard,'GỬI LẠI EMAIL XÁC NHẬN',()=>{void resendSignupConfirmation(dashboard,email);});}}catch(error){console.error('Không thể đăng ký Supabase.',error);const translated=translateAuthError(error);if(translated.waitSeconds)startSignupCooldown(translated.waitSeconds,dashboard);setAccountStatus(translated.message,true,dashboard);}finally{accountRequestPending=false;updateSignupButton(dashboard);if(loginButton){loginButton.disabled=false;loginButton.textContent='ĐĂNG NHẬP';}}}
async function resendSignupConfirmation(dashboard,email){if(accountRequestPending)return;const remaining=signupCooldownRemaining();if(remaining){setAccountStatus(`Vui lòng đợi ${remaining} giây trước khi gửi lại email.`,true,dashboard);updateSignupButton(dashboard);return;}accountRequestPending=true;updateSignupButton(dashboard);try{await supabaseRequest('/auth/v1/resend',{method:'POST',body:{type:'signup',email}});startSignupCooldown(45,dashboard);setAccountStatus('Đã yêu cầu gửi lại email xác nhận. Kiểm tra hộp thư và thư mục spam.',false,dashboard);}catch(error){console.error('Không thể gửi lại email xác nhận.',error);const translated=translateAuthError(error);if(translated.waitSeconds)startSignupCooldown(translated.waitSeconds,dashboard);setAccountStatus(translated.message,true,dashboard);}finally{accountRequestPending=false;updateSignupButton(dashboard);}}
async function signInAccount(dashboard){if(accountRequestPending)return;const form=dashboard.querySelector('[data-account-form]');if(!form.reportValidity())return;const email=form.elements.email.value.trim(),password=form.elements.password.value;accountRequestPending=true;updateSignupButton(dashboard);const loginButton=dashboard.querySelector('[data-account-login]');if(loginButton){loginButton.disabled=true;loginButton.textContent='ĐANG ĐĂNG NHẬP...';}try{const result=await supabaseRequest('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});storeAuthSession(result);renderAccountDashboard(dashboard);setAccountStatus('Đăng nhập thành công. Điểm các ván tiếp theo sẽ được gửi lên bảng xếp hạng.',false,dashboard);}catch(error){console.error('Không thể đăng nhập Supabase.',error);setAccountStatus(translateAuthError(error).message,true,dashboard);}finally{accountRequestPending=false;updateSignupButton(dashboard);if(loginButton){loginButton.disabled=false;loginButton.textContent='ĐĂNG NHẬP';}}}
function renderAccountDashboard(dashboard=document.getElementById('accountDashboard')){
  if(!dashboard)return;
  if(recoveryAccessToken){
    dashboard.innerHTML=`<div class="account-status" role="status">Liên kết hợp lệ. Tạo mật khẩu mới để tiếp tục.</div>
      <form class="account-form" data-recovery-form>
        <label>Mật khẩu mới <span class="account-password-input"><input name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="Ít nhất 6 ký tự"><button type="button" data-recovery-password-toggle aria-label="Hiện mật khẩu">Hiện</button></span></label>
        <label>Nhập lại mật khẩu <input name="passwordConfirm" type="password" required minlength="6" autocomplete="new-password" placeholder="Nhập lại mật khẩu mới"></label>
        <div class="account-actions"><button class="play-btn compact" type="submit" data-recovery-submit>ĐỔI MẬT KHẨU</button></div>
      </form>`;
    const form=dashboard.querySelector('[data-recovery-form]');
    form.onsubmit=event=>{event.preventDefault();void updateRecoveredPassword(dashboard);};
    dashboard.querySelector('[data-recovery-password-toggle]').onclick=event=>{
      const input=form.elements.password,visible=input.type==='password';
      input.type=visible?'text':'password';
      event.currentTarget.textContent=visible?'Ẩn':'Hiện';
      event.currentTarget.setAttribute('aria-label',visible?'Ẩn mật khẩu':'Hiện mật khẩu');
    };
    return;
  }
  if(authSession){
    dashboard.innerHTML=`<div class="account-status" role="status">Đang đăng nhập với biệt danh <b>${escapeHtml(authNickname())}</b>. Email của bạn không hiển thị trên bảng xếp hạng.</div><div class="account-actions"><button class="secondary-btn" data-account-change-password>ĐỔI MẬT KHẨU</button><button class="secondary-btn" data-account-signout>ĐĂNG XUẤT</button></div>`;
    dashboard.querySelector('[data-account-change-password]').onclick=()=>showChangePasswordForm(dashboard);
    dashboard.querySelector('[data-account-signout]').onclick=async()=>{
      try{
        if(authSession)await supabaseRequest('/auth/v1/logout',{method:'POST',authenticated:true});
        clearAuthSession();
        renderAccountDashboard(dashboard);
        setAccountStatus('Đã đăng xuất khỏi tài khoản.',false,dashboard);
      }catch(error){
        console.error('Không thể đăng xuất khỏi Supabase.',error);
        setAccountStatus(translateAuthError(error).message,true,dashboard);
      }
    };
    return;
  }
  dashboard.innerHTML=`<div class="account-status hidden" role="status"></div>
    <div class="account-mode-switch" role="tablist" aria-label="Chọn đăng nhập hoặc đăng ký">
      <button type="button" role="tab" data-account-switch="login" aria-selected="true">ĐĂNG NHẬP</button>
      <button type="button" role="tab" data-account-switch="signup" aria-selected="false">TẠO TÀI KHOẢN</button>
    </div>
    <form class="account-form" data-account-form data-mode="login">
      <label data-account-nickname hidden>Biệt danh <input name="nickname" type="text" minlength="2" maxlength="24" autocomplete="nickname" placeholder="Tên sẽ hiện trên bảng xếp hạng"></label>
      <label>Email <input name="email" type="email" required autocomplete="email" placeholder="ban@email.com"></label>
      <label>Mật khẩu <span class="account-password-input"><input name="password" type="password" required minlength="6" autocomplete="current-password" placeholder="Ít nhất 6 ký tự"><button type="button" data-password-toggle aria-label="Hiện mật khẩu">Hiện</button></span></label>
      <label data-account-confirm hidden>Nhập lại mật khẩu <input name="passwordConfirm" type="password" autocomplete="new-password" placeholder="Nhập lại mật khẩu"></label>
      <div class="account-actions"><button class="play-btn compact" type="submit" data-account-submit>ĐĂNG NHẬP</button></div>
      <button class="account-text-button" type="button" data-account-recover>QUÊN MẬT KHẨU?</button>
      <small>Email chỉ dùng đăng nhập và không xuất hiện công khai.</small>
    </form>`;
  dashboard.querySelectorAll('[data-account-switch]').forEach(button=>button.onclick=()=>switchAccountMode(dashboard,button.dataset.accountSwitch));
  const form=dashboard.querySelector('[data-account-form]');
  form.onsubmit=event=>{
    event.preventDefault();
    if(form.dataset.mode==='signup')void signUpAccount(dashboard);
    else void signInAccount(dashboard);
  };
  dashboard.querySelector('[data-password-toggle]').onclick=event=>{
    const input=form.elements.password;
    const visible=input.type==='password';
    input.type=visible?'text':'password';
    event.currentTarget.textContent=visible?'Ẩn':'Hiện';
    event.currentTarget.setAttribute('aria-label',visible?'Ẩn mật khẩu':'Hiện mật khẩu');
  };
  dashboard.querySelector('[data-account-recover]').onclick=()=>void recoverAccount(dashboard);
  updateSignupButton(dashboard);
  if(recoveryCallbackError)setAccountStatus('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Nhập email rồi chọn QUÊN MẬT KHẨU? để yêu cầu liên kết mới.',true,dashboard);
}
function showChangePasswordForm(dashboard){
  dashboard.innerHTML=`<div class="account-status" role="status">Đổi mật khẩu trực tiếp cho tài khoản đang đăng nhập. Không cần gửi email.</div>
    <form class="account-form" data-change-password-form>
      <label>Mật khẩu mới <input name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="Ít nhất 6 ký tự"></label>
      <label>Nhập lại mật khẩu mới <input name="passwordConfirm" type="password" required minlength="6" autocomplete="new-password" placeholder="Nhập lại mật khẩu mới"></label>
      <div class="account-actions"><button class="play-btn compact" type="submit" data-change-password-submit>ĐỔI MẬT KHẨU</button><button class="secondary-btn" type="button" data-change-password-cancel>HỦY</button></div>
    </form>`;
  const form=dashboard.querySelector('[data-change-password-form]');
  form.onsubmit=event=>{event.preventDefault();void changeAccountPassword(dashboard);};
  dashboard.querySelector('[data-change-password-cancel]').onclick=()=>renderAccountDashboard(dashboard);
}
function switchAccountMode(dashboard,mode){
  if(mode!=='login'&&mode!=='signup')return;
  const form=dashboard.querySelector('[data-account-form]'),signingUp=mode==='signup';
  form.dataset.mode=mode;
  const nickname=form.querySelector('[data-account-nickname]'),confirmation=form.querySelector('[data-account-confirm]'),submit=form.querySelector('[data-account-submit]'),recover=form.querySelector('[data-account-recover]'),password=form.elements.password;
  nickname.hidden=!signingUp;
  nickname.querySelector('input').required=signingUp;
  confirmation.hidden=!signingUp;
  confirmation.querySelector('input').required=signingUp;
  password.autocomplete=signingUp?'new-password':'current-password';
  submit.textContent=signingUp?'ĐĂNG KÝ':'ĐĂNG NHẬP';
  const signupButton=signingUp?submit:null;
  if(signupButton)signupButton.dataset.accountSignup='';
  else submit.removeAttribute('data-account-signup');
  dashboard.querySelectorAll('[data-account-switch]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.accountSwitch===mode)));
  recover.hidden=signingUp;
  const status=dashboard.querySelector('.account-status');
  status.classList.add('hidden');
  status.replaceChildren();
  updateSignupButton(dashboard);
}
async function signUpAccount(dashboard){
  if(accountRequestPending)return;
  const form=dashboard.querySelector('[data-account-form]');
  if(form.dataset.mode!=='signup'){switchAccountMode(dashboard,'signup');return;}
  const nickname=form.elements.nickname.value.trim(),email=form.elements.email.value.trim(),password=form.elements.password.value,remaining=signupCooldownRemaining();
  if(remaining){
    setAccountStatus(`Vui lòng đợi ${remaining} giây trước khi gửi yêu cầu đăng ký tiếp theo.`,true,dashboard);
    updateSignupButton(dashboard);
    return;
  }
  if(nickname.length<2||nickname.length>24){
    setAccountStatus('Biệt danh cần từ 2 đến 24 ký tự.',true,dashboard);
    form.elements.nickname.focus();
    return;
  }
  if(password!==form.elements.passwordConfirm.value){
    setAccountStatus('Hai mật khẩu chưa khớp. Hãy nhập lại.',true,dashboard);
    form.elements.passwordConfirm.focus();
    return;
  }
  if(!form.reportValidity())return;
  accountRequestPending=true;
  updateSignupButton(dashboard);
  const submit=form.querySelector('[data-account-submit]');
  if(submit){submit.disabled=true;submit.textContent='ĐANG TẠO TÀI KHOẢN...';}
  try{
    const result=await supabaseRequest('/auth/v1/signup',{method:'POST',body:{email,password,data:{display_name:nickname}}});
    if(result.access_token){
      storeAuthSession(result);
      renderAccountDashboard(dashboard);
      setAccountStatus('Tạo tài khoản thành công. Bạn đã đăng nhập và có thể chơi ngay.',false,dashboard);
    }else if(!result.user||!Array.isArray(result.user.identities)||result.user.identities.length===0){
      setAccountStatus('Email này đã có tài khoản. Chuyển sang tab ĐĂNG NHẬP để dùng email và mật khẩu đó.',true,dashboard,'ĐI TỚI ĐĂNG NHẬP',()=>switchAccountMode(dashboard,'login'));
    }else{
      localStorage.removeItem(SIGNUP_COOLDOWN_KEY);
      setAccountStatus('Đã gửi yêu cầu đăng ký. Hãy mở email xác nhận trong hộp thư hoặc thư mục spam, rồi quay lại tab ĐĂNG NHẬP.',false,dashboard,'GỬI LẠI EMAIL XÁC NHẬN',()=>void resendSignupConfirmation(dashboard,email));
    }
  }catch(error){
    console.error('Không thể đăng ký Supabase.',error);
    const translated=translateAuthError(error);
    if(translated.waitSeconds)startSignupCooldown(translated.waitSeconds);
    setAccountStatus(translated.message,true,dashboard);
  }finally{
    accountRequestPending=false;
    updateSignupButton(dashboard);
    if(submit&&!authSession){submit.disabled=false;submit.textContent='ĐĂNG KÝ';}
  }
}
async function signInAccount(dashboard){
  if(accountRequestPending)return;
  const form=dashboard.querySelector('[data-account-form]');
  if(!form.reportValidity())return;
  const email=form.elements.email.value.trim(),password=form.elements.password.value;
  accountRequestPending=true;
  updateSignupButton(dashboard);
  const submit=form.querySelector('[data-account-submit]');
  if(submit){submit.disabled=true;submit.textContent='ĐANG ĐĂNG NHẬP...';}
  try{
    const result=await supabaseRequest('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
    storeAuthSession(result);
    renderAccountDashboard(dashboard);
    setAccountStatus('Đăng nhập thành công. Điểm các ván tiếp theo sẽ được gửi lên bảng xếp hạng.',false,dashboard);
  }catch(error){
    console.error('Không thể đăng nhập Supabase.',error);
    setAccountStatus(translateAuthError(error).message,true,dashboard);
  }finally{
    accountRequestPending=false;
    updateSignupButton(dashboard);
    if(submit&&!authSession){submit.disabled=false;submit.textContent='ĐĂNG NHẬP';}
  }
}
async function recoverAccount(dashboard){
  if(accountRequestPending)return;
  const form=dashboard.querySelector('[data-account-form]'),email=form.elements.email.value.trim();
  if(!email){setAccountStatus('Nhập email của bạn trước để nhận liên kết đặt lại mật khẩu.',true,dashboard);form.elements.email.focus();return;}
  if(!form.elements.email.validity.valid){setAccountStatus('Địa chỉ email chưa đúng định dạng.',true,dashboard);form.elements.email.focus();return;}
  accountRequestPending=true;
  const button=dashboard.querySelector('[data-account-recover]');
  button.disabled=true;
  try{
    const redirectTo=`${location.origin}${location.pathname}`;
    await supabaseRequest(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,{method:'POST',body:{email}});
    setAccountStatus('Nếu email có tài khoản, Supabase sẽ gửi liên kết đặt lại mật khẩu. Kiểm tra hộp thư và thư mục spam.',false,dashboard);
  }catch(error){
    console.error('Không thể yêu cầu đặt lại mật khẩu.',error);
    const translated=translateAuthError(error);
    if(translated.waitSeconds)startSignupCooldown(translated.waitSeconds);
    setAccountStatus(translated.message,true,dashboard);
  }finally{
    accountRequestPending=false;
    button.disabled=false;
  }
}
async function updateRecoveredPassword(dashboard){
  if(accountRequestPending)return;
  if(!recoveryAccessToken){
    setAccountStatus('Liên kết đặt lại mật khẩu không còn hợp lệ. Hãy yêu cầu một liên kết mới.',true,dashboard);
    return;
  }
  const form=dashboard.querySelector('[data-recovery-form]'),password=form.elements.password.value;
  if(password!==form.elements.passwordConfirm.value){
    setAccountStatus('Hai mật khẩu chưa khớp. Hãy nhập lại.',true,dashboard);
    form.elements.passwordConfirm.focus();
    return;
  }
  if(!form.reportValidity())return;
  accountRequestPending=true;
  const submit=form.querySelector('[data-recovery-submit]');
  submit.disabled=true;
  submit.textContent='ĐANG ĐỔI MẬT KHẨU...';
  try{
    const response=await fetch(supabaseUrl('/auth/v1/user'),{method:'PUT',headers:{apikey:SUPABASE_CONFIG.publishableKey,Authorization:`Bearer ${recoveryAccessToken}`,'Content-Type':'application/json'},body:JSON.stringify({password})});
    const text=await response.text();
    let result=null;
    if(text){try{result=JSON.parse(text);}catch{result={message:text};}}
    if(!response.ok)throw new Error(result?.msg||result?.message||result?.error_description||`Không đổi được mật khẩu (${response.status}).`);
    recoveryAccessToken=null;
    renderAccountDashboard(dashboard);
    setAccountStatus('Đổi mật khẩu thành công. Đăng nhập bằng mật khẩu mới.',false,dashboard);
  }catch(error){
    console.error('Không thể đặt lại mật khẩu Supabase.',error);
    const message=String(error.message||'Không thể đổi mật khẩu. Hãy thử lại hoặc yêu cầu liên kết mới.');
    if(/expired|invalid|token/i.test(message)){
      recoveryAccessToken=null;
      renderAccountDashboard(dashboard);
      setAccountStatus('Liên kết đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu một liên kết đặt lại mới.',true,dashboard);
    }else{
      setAccountStatus(message,true,dashboard);
    }
  }finally{
    accountRequestPending=false;
    if(recoveryAccessToken&&submit.isConnected){submit.disabled=false;submit.textContent='ĐỔI MẬT KHẨU';}
  }
}
async function changeAccountPassword(dashboard){
  if(accountRequestPending)return;
  const form=dashboard.querySelector('[data-change-password-form]');
  if(!form.reportValidity())return;
  const password=form.elements.password.value;
  if(password!==form.elements.passwordConfirm.value){
    setAccountStatus('Hai mật khẩu chưa khớp. Hãy nhập lại.',true,dashboard);
    form.elements.passwordConfirm.focus();
    return;
  }
  accountRequestPending=true;
  const submit=form.querySelector('[data-change-password-submit]');
  submit.disabled=true;
  submit.textContent='ĐANG ĐỔI MẬT KHẨU...';
  try{
    await supabaseRequest('/auth/v1/user',{method:'PUT',body:{password},authenticated:true});
    renderAccountDashboard(dashboard);
    setAccountStatus('Đổi mật khẩu thành công. Tài khoản vẫn đang đăng nhập.',false,dashboard);
  }catch(error){
    console.error('Không thể đổi mật khẩu tài khoản.',error);
    setAccountStatus(translateAuthError(error).message||'Không thể đổi mật khẩu. Hãy thử lại.',true,dashboard);
  }finally{
    accountRequestPending=false;
    if(submit.isConnected){submit.disabled=false;submit.textContent='ĐỔI MẬT KHẨU';}
  }
}
if(signupCooldownRemaining())startSignupCooldown(signupCooldownRemaining());