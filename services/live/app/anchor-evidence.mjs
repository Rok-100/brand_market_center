// An attachment must identify one anchor; nearby captions must be unambiguous.
export function recordingCaption(message, messages, names) {
  const owners = text => [...names].filter(name => String(text || '').replace(/\s+/gu, '').includes(name));
  const own = owners(message.text);
  if (own.length) return own.length === 1 ? {name:own[0],text:message.text} : null;
  const sender = message.sender?.id || message.sender?.name;
  if (!sender) return null;
  const candidates = messages.filter(item => (item.sender?.id || item.sender?.name) === sender
    && Math.abs(Date.parse(item.createdAt) - Date.parse(message.createdAt)) <= 300000
    && owners(item.text).length);
  const attributed = new Set(candidates.flatMap(item => owners(item.text)));
  if (attributed.size !== 1) return null;
  candidates.sort((a,b) => Math.abs(Date.parse(a.createdAt)-Date.parse(message.createdAt))-Math.abs(Date.parse(b.createdAt)-Date.parse(message.createdAt)));
  return {name:[...attributed][0],text:candidates[0].text};
}

// Share one bounded read across cards. Never replace a failed current read with an old snapshot.
export function createAnchorEvidenceReader({loadProfiles,loadNames,loadEvidence,now=Date.now,ttl=60000}) {
  let cached, expires=0, pending;
  async function load() {
    const [official, fallback] = await Promise.allSettled([loadProfiles(),loadNames()]);
    const profiles = official.status === 'fulfilled' ? official.value : [];
    const names = new Set([...profiles.map(item=>item.name),...(fallback.status==='fulfilled'?fallback.value:[])]);
    if (!names.size) throw new Error('主播名册读取失败，请稍后重试。');
    const evidence = await loadEvidence(names);
    const value={profiles,evidence,profileSource:{name:'主播培养档案',available:official.status==='fulfilled',fetchedAt:new Date(now()).toISOString()}};
    cached=value;expires=now()+ttl;return value;
  }
  return async name => {
    if (!cached || now()>=expires) {
      if (!pending) pending=load().finally(()=>{pending=null});
      await pending;
    }
    const evidence=cached.evidence.evidenceByAnchor?.[name];
    if (!evidence) {const error=new Error('未找到该主播档案。');error.status=404;throw error;}
    return {name,profile:cached.profiles.find(item=>item.name===name)||null,profileSource:cached.profileSource,
      evidence,sources:cached.evidence.sources,fetchedAt:cached.evidence.fetchedAt};
  };
}
