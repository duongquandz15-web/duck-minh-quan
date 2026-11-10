const installAppButton=document.getElementById('installAppBtn');
let deferredInstallPrompt=null;

if('serviceWorker' in navigator&&window.isSecureContext){
  navigator.serviceWorker.register('./service-worker.js',{scope:'./'}).catch(error=>console.error('Không thể đăng ký chế độ cài game.',error));
}

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  deferredInstallPrompt=event;
});

window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  installAppButton.textContent='✅ GAME ĐÃ ĐƯỢC CÀI';
  installAppButton.disabled=true;
});

installAppButton.addEventListener('click',async()=>{
  if(deferredInstallPrompt){
    const prompt=deferredInstallPrompt;
    deferredInstallPrompt=null;
    await prompt.prompt();
    const choice=await prompt.userChoice;
    if(choice.outcome==='accepted'){
      installAppButton.textContent='✅ ĐANG CÀI GAME';
      installAppButton.disabled=true;
    }
    return;
  }

  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const instructions=ios
    ?'Mở link này bằng Safari, nhấn nút Chia sẻ rồi chọn “Thêm vào Màn hình chính”.'
    :'Mở menu của trình duyệt (⋮ hoặc Chia sẻ) rồi chọn “Cài đặt ứng dụng” hoặc “Thêm vào màn hình chính”.';
  if(typeof window.showModal==='function'){
    window.showModal('CÀI GAME MIỄN PHÍ',instructions);
  }else{
    window.alert(instructions);
  }
});
