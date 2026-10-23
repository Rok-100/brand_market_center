(() => {
 const link=document.querySelector('[data-material-home]');
 link?.addEventListener('click',event=>{
  if(window.parent!==window){
   try{if(parent.document.querySelector('[data-material-panel]')){event.preventDefault();parent.postMessage({type:'live-materials-home'},location.origin);}}
   catch{/* The ordinary same-origin link remains usable. */}
  }
 });
})();
