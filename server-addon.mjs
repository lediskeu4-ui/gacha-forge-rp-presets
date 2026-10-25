// Host-private API adapter. Fail closed if this Engine layout is incompatible.
import { getDB } from '../../../../../dist/db/connection.js';
import { createPromptsStorage } from '../../../../../dist/services/storage/prompts.storage.js';
import { assemblePrompt } from '../../../../../dist/services/prompt/assembler.js';

export function combineMessages(presetMessages, gameMessages) {
  return [
    ...presetMessages.filter(m => ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim()).map(m => ({role: m.role, content: m.content})),
    {role: 'system', content: 'Apply the preceding preset as writing and roleplay guidance. The following Gacha Forge task specifies the required output schema, game facts and speaker constraints. Preserve that schema exactly; do not add wrappers or commentary.'},
    ...gameMessages,
  ];
}

export async function setupPresets(routes, runtime, pkg, readRun) {
  const db = await getDB();
  const storage = createPromptsStorage(db);
  const docs = runtime.persistence.documents;
  const key = runId => `rp-preset:${runId}`;
  async function config(runId) {
    return (await docs.getById(pkg.id, key(runId)))?.data ?? {};
  }
  async function requireRun(runId) {
    if (typeof runId !== 'string' || !runId || runId.length > 240 || !await readRun(runId)) throw new Error('월드를 먼저 선택해줘.');
  }
  routes.get('/rp-presets', async request => {
    const runId = request.query?.runId;
    await requireRun(runId);
    return {ok: true, config: await config(runId), presets: (await storage.list()).map(p => ({id:p.id, name:p.name}))};
  });
  routes.post('/rp-presets', async (request, reply) => {
    const body = request.body ?? {};
    try {
      await requireRun(body.runId);
      const presetId = typeof body.presetId === 'string' ? body.presetId : '';
      if (presetId && !await storage.getById(presetId)) return reply.code(400).send({error:'프리셋을 찾지 못했어.'});
      const data = {presetId, narration: body.narration === true, chat: body.chat === true};
      const id = key(body.runId), existing = await docs.getById(pkg.id,id), now = new Date().toISOString();
      if (existing) {
        const saved = await docs.update({id,packageId:pkg.id,expectedRevision:existing.revision,name:existing.name,description:existing.description,data,updatedAt:now});
        if (!saved) return reply.code(409).send({error:'다른 기기에서 설정이 바뀌었어. 다시 열어줘.'});
      } else await docs.create({id,packageId:pkg.id,kind:'rp-preset-config',name:'RP preset',description:'Gacha Forge RP preset selection',data,createdAt:now,updatedAt:now});
      return {ok:true};
    } catch (error) { return reply.code(400).send({error:error.message}); }
  });
  return async (runId,run,job,messages) => {
    if (!['narration','chat'].includes(job)) return messages;
    const cfg = await config(runId);
    if (!cfg.presetId || !cfg[job]) return messages;
    const preset = await storage.getById(cfg.presetId);
    if (!preset) throw new Error('선택한 RP 프리셋이 삭제됐어. RP 프리셋 설정에서 다시 선택해줘.');
    const [sections,groups,choiceBlocks] = await Promise.all([storage.listSections(preset.id),storage.listGroups(preset.id),storage.listChoiceBlocksForPreset(preset.id)]);
    // Use an isolated context: no unrelated RP chat/history, agents, or global lorebooks.
    const output = await assemblePrompt({
      db,preset,sections,groups,choiceBlocks,chatChoices:{},
      chatId:`gacha-rp:${runId}`,characterIds:[],
      personaName:run?.protagonist?.name || 'Player',
      personaDescription:JSON.stringify(run?.protagonist ?? {}),
      chatMessages:[],disableLorebooks:true,enableAgents:false,activeLorebookIds:[],
      groupScenarioOverrideText:run?.scenario || '',previewOnly:true,
    });
    if (!Array.isArray(output.messages)) throw new Error('Engine 프리셋 처리 결과가 호환되지 않아.');
    if (runtime.isDebugAgentsEnabled?.()) runtime.logger.debug({runId,presetId:preset.id,job,messages:combineMessages(output.messages,messages)},'[gacha-rp-presets] assembled prompt');
    return combineMessages(output.messages,messages);
  };
}
