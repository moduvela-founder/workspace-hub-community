// Shared by the browser and CLI. A reference carries identity, never live status.
export function formatReference(asset, hubRoot) {
  if (!asset || typeof asset.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(asset.id)) throw new Error('Invalid asset ID');
  if (typeof asset.title !== 'string' || typeof hubRoot !== 'string' || !hubRoot.trim()) throw new Error('Invalid asset reference');
  const oneLine = value => value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
  const root = oneLine(hubRoot).replace(/[\\/]+$/, '');
  return `workspace-hub:${asset.id}\n名称：${oneLine(asset.title)}\n索引库：${root}/catalog/assets.json`;
}

export function formatMemberReference(asset, member, hubRoot) {
  const reference = formatReference(asset, hubRoot);
  if (!member || typeof member.id !== 'string' || member.id.length > 240 || !member.id.split('/').every(part => /^[a-z0-9][a-z0-9._-]*$/.test(part) && part !== '.' && part !== '..') || typeof member.title !== 'string') throw new Error('Invalid member reference');
  const title = member.title.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
  return reference.replace(`workspace-hub:${asset.id}`, () => `workspace-hub:${asset.id}#${member.id}`).replace(/^名称：.*$/m, () => `名称：${asset.title.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim()} / ${title}`);
}
