(() => {
  const config = window.SHIZHI_CONFIG || {};
  let client = null, admin = false;
  const bucket = 'tutorial-images';
  const enabled = Boolean(config.url && config.publicKey);
  function requireClient() {
    if (!enabled) throw Error('云端尚未连接，请先完成网站配置。');
    if (!client) {
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url)) throw Error('项目 URL 格式不正确。');
      if (config.publicKey.startsWith('sb_secret_')) throw Error('请使用 publishable 公钥，不要使用 secret key。');
      if (config.publicKey.startsWith('eyJ')) {
        try {const payload=JSON.parse(atob(config.publicKey.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(payload.role!=='anon')throw Error('not-public');}
        catch {throw Error('这里只能填写 publishable 或 anon 公钥。');}
      }
      if (!window.supabase) throw Error('登录组件加载失败，请检查网络后刷新。');
      client = window.supabase.createClient(config.url, config.publicKey);
    }
    return client;
  }
  function checked(result) {
    if (result.error) {
      const code = result.error.code;
      if (code === '42501' || result.error.status === 403) throw Error('当前账号没有发布权限，请检查管理员配置。');
      if (code === '23505') throw Error('此教程已发布，请刷新后重新编辑，避免覆盖其他修改。');
      throw Error(result.error.message || '云端请求失败，请稍后重试。');
    }
    return result.data;
  }
  async function isAdmin() {
    const c = requireClient();
    const {data:{session},error} = await c.auth.getSession();
    if (error) throw error;
    if (!session) return admin = false;
    const rows = checked(await c.from('shizhi_admins').select('user_id').eq('user_id',session.user.id));
    return admin = rows.length > 0;
  }
  function requireAdmin() { if (!admin) throw Error('请先使用管理员账号登录。'); }
  function isPublicImage(value) {
    if (typeof value !== 'string' || !enabled) return false;
    try { const u = new URL(value), base = new URL(config.url); return u.origin === base.origin && u.pathname.startsWith(`/storage/v1/object/public/${bucket}/`) && !u.search && !u.hash; } catch {return false;}
  }
  function rowTutorial(row) {
    const c = row.content;
    if (!c || typeof c.title !== 'string' || !Array.isArray(c.steps)) throw Error('云端教程格式不正确，请联系管理员。');
    return {...c,id:row.id,remoteVersion:row.updated_at};
  }
  async function list() {
    const c = requireClient();
    let rows = [], offset = 0;
    while (true) {
      const batch = checked(await c.from('shizhi_tutorials').select('id,content,updated_at').order('id').range(offset,offset+499));
      rows.push(...batch);
      if (batch.length < 500) break;
      offset += 500;
    }
    return rows.map(rowTutorial);
  }
  async function upload(image, added) {
    if (!image || isPublicImage(image)) return image || '';
    if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)) throw Error('图片格式不受支持，请重新上传。');
    const c = requireClient();
    const blob = await (await fetch(image)).blob();
    const ext = blob.type.split('/')[1];
    const path = `${crypto.randomUUID()}.${ext}`;
    checked(await c.storage.from(bucket).upload(path,blob,{contentType:blob.type,upsert:false}));
    added.push(path);
    return c.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }
  async function prepare(t, added) {
    const steps = [];
    for (const s of t.steps) steps.push({title:s.title,text:s.text,image:await upload(s.image,added)});
    return {id:t.id,content:{title:t.title,summary:t.summary,category:t.category,minutes:t.minutes,createdAt:t.createdAt,art:t.art||2,symbol:t.symbol||'▤',word:t.word||'LEARN & GROW',cover:await upload(t.cover,added),steps}};
  }
  async function publish(t) {
    requireAdmin();
    const c = requireClient(), added = [];
    try {
      const row = await prepare(t,added);
      const result = t.remoteVersion
        ? await c.from('shizhi_tutorials').update({content:row.content}).eq('id',t.id).eq('updated_at',t.remoteVersion).select('id,content,updated_at')
        : await c.from('shizhi_tutorials').insert(row).select('id,content,updated_at');
      const rows = checked(result);
      if (!rows.length) throw Error('教程已被其他页面修改或删除。请先复制当前文字，再刷新后重新编辑。');
      return rowTutorial(rows[0]);
    } catch(error) {throw error;}
  }
  async function publishMany(items) {
    requireAdmin();const c = requireClient(), added = [];
    try {
      const rows = [];
      for (const t of items) rows.push(await prepare(t,added));
      if (!rows.length) return [];
      return checked(await c.from('shizhi_tutorials').insert(rows).select('id,content,updated_at')).map(rowTutorial);
    } catch(error) {throw error;}
  }
  async function remove(t) {
    requireAdmin();
    const rows = checked(await requireClient().from('shizhi_tutorials').delete().eq('id',t.id).eq('updated_at',t.remoteVersion).select('id'));
    if (!rows.length) throw Error('教程已被修改或删除，请刷新后重试。');
  }
  async function login(email,password) {
    const c = requireClient();checked(await c.auth.signInWithPassword({email,password}));
    if (!await isAdmin()) {await c.auth.signOut();throw Error('账号已登录，但尚未设置为网站管理员。');}
  }
  async function logout() {checked(await requireClient().auth.signOut());admin=false;}
  window.shizhiCloud={enabled,isPublicImage,isAdmin,list,publish,publishMany,remove,login,logout};
})();
