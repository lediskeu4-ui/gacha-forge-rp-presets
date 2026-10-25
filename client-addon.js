// Runs inside Gacha Forge's existing module and uses its authenticated fetch helper.
{
  const proto = ec.prototype;
  const originalConnected = proto.connectedCallback;
  const originalDisconnected = proto.disconnectedCallback;
  proto.connectedCallback = function () {
    originalConnected.call(this);
    if (this._rpPresetButton) return;
    const button = document.createElement('button');
    button.textContent = 'RP 프리셋';
    button.style.cssText = 'position:absolute;right:12px;top:52px;z-index:10000;padding:7px 12px;border:1px solid #ab8acc;border-radius:8px;background:#242034;color:white;cursor:pointer;font:13px sans-serif';
    button.onclick = () => openPresets(this);
    const place = () => { if (!this._root.contains(button)) this._root.append(button); };
    this._rpPresetButton = button;
    this._rpPresetObserver = new MutationObserver(place);
    this._rpPresetObserver.observe(this._root,{childList:true});
    place();
  };
  proto.disconnectedCallback = function () {
    this._rpPresetObserver?.disconnect();
    this._rpPresetButton?.remove();
    this._rpPresetPanel?.remove();
    this._rpPresetButton = null;
    originalDisconnected.call(this);
  };
  async function openPresets(host) {
    const runId = host._run?.runId;
    if (!runId) { alert('월드에 들어간 다음 RP 프리셋을 선택해줘.'); return; }
    host._rpPresetPanel?.remove();
    const overlay = document.createElement('div');
    host._rpPresetPanel = overlay;
    overlay.style.cssText = 'position:absolute;inset:0;z-index:10001;display:grid;place-items:center;background:#0009;color:#eee;font:14px sans-serif';
    const panel = document.createElement('div');
    panel.style.cssText = 'width:min(430px,90%);max-height:85%;overflow:auto;padding:22px;box-sizing:border-box;background:#262235;border:1px solid #ad91c5;border-radius:14px';
    overlay.append(panel); host._root.append(overlay);
    const title = document.createElement('h3'); title.textContent='RP 프리셋 연결';panel.append(title);
    const note = document.createElement('p');note.textContent='불러오는 중…';panel.append(note);
    const close = document.createElement('button');close.textContent='닫기';close.onclick=()=>overlay.remove();panel.append(close);
    try {
      const res=await Ze(`${Ia}/rp-presets?runId=${encodeURIComponent(runId)}`);
      const data=await res.json();
      if(!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      note.textContent='이 월드의 새 스토리·채팅 생성에 적용돼. 기존 내용은 바뀌지 않아. 프리셋의 기본 선택값을 사용하고, 별도 RP 채팅 기록·로어북·모델 파라미터는 가져오지 않아.';
      const select=document.createElement('select');select.style.cssText='width:100%;padding:9px;margin:8px 0';
      select.add(new Option('사용 안 함',''));
      for(const p of data.presets) select.add(new Option(p.name,p.id));
      select.value=data.config.presetId || '';panel.insertBefore(select,close);
      function toggle(text,checked) {const label=document.createElement('label');label.style.cssText='display:block;margin:12px 0';const box=document.createElement('input');box.type='checkbox';box.checked=checked;label.append(box,document.createTextNode(' '+text));panel.insertBefore(label,close);return box;}
      const narration=toggle('스토리 서술',data.config.narration ?? true), chat=toggle('캐릭터 채팅',data.config.chat ?? true);
      const save=document.createElement('button');save.textContent='저장';save.style.cssText='margin-right:10px;padding:6px 14px';panel.insertBefore(save,close);
      save.onclick=async()=>{save.disabled=true;try{
        if(host._run?.runId!==runId) throw new Error('월드가 바뀌었어. 설정을 다시 열어줘.');
        const r=await Ze(`${Ia}/rp-presets`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId,presetId:select.value,narration:narration.checked,chat:chat.checked})});
        const result=await r.json();if(!r.ok||!result.ok)throw new Error(result.error||`HTTP ${r.status}`);
        note.textContent='저장했어! 다음 생성부터 적용돼.';
      }catch(error){note.textContent=error.message;}finally{save.disabled=false;}};
    } catch(error) {note.textContent=`설정을 불러오지 못했어: ${error.message}`;}
  }
}
