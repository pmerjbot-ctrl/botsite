import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits, AttachmentBuilder
} from 'discord.js';

const {DISCORD_BOT_TOKEN,DISCORD_GUILD_ID,SITE_URL,DISCORD_INTERNAL_SECRET,DISCORD_CLIENT_ID,DISCORD_POLICE_ROLE_ID}=process.env;
const POLL_MS=Math.max(5000,Number(process.env.POLL_MS||10000));
const VERSION='4.0.0-v9';
if(!DISCORD_BOT_TOKEN||!DISCORD_GUILD_ID||!SITE_URL||!DISCORD_INTERNAL_SECRET||!DISCORD_CLIENT_ID) throw new Error('Variáveis do bot incompletas');
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
const startedAt=new Date().toISOString(); let lastError='';

async function api(path,opts={}){return fetch(`${SITE_URL.replace(/\/$/,'')}${path}`,{...opts,headers:{authorization:`Bearer ${DISCORD_INTERNAL_SECRET}`,'content-type':'application/json',...(opts.headers||{})}})}
async function applyRole(member,roleId,mode='add'){if(!roleId)return;if(mode==='remove'){if(member.roles.cache.has(roleId))await member.roles.remove(roleId)}else if(!member.roles.cache.has(roleId))await member.roles.add(roleId)}
async function safeDm(member,content,components){try{await member.send({content:String(content).slice(0,1900),components:components||[]});return true}catch(e){console.warn('DM não entregue para',member.id,e.message);return false}}
function nickname(rank,name,rg){const prefix=`${rank||''} `.trimStart();const suffix=` - ${rg||''}`;let n=String(name||'Membro');let out=`${prefix}${n}${suffix}`.trim();if(out.length<=32)return out;const room=Math.max(1,32-prefix.length-suffix.length);n=n.slice(0,room).trim();return `${prefix}${n}${suffix}`.slice(0,32).trim()}
async function syncNickname(member,p){if(!p.game_name||!p.rg||!p.rank_name)return;const n=nickname(p.rank_name,p.game_name,p.rg);if(member.nickname!==n){try{await member.setNickname(n,'Sincronização Centro de Gestão Interna')}catch(e){console.warn('Falha ao alterar apelido',member.id,e.message)}}}
async function processItem(item){
  if(!item.discord_id) throw new Error('Usuário sem Discord ID vinculado');
  const guild=await client.guilds.fetch(DISCORD_GUILD_ID); const member=await guild.members.fetch(item.discord_id); const p=item.payload||{};
  if(item.kind==='RANK_CHANGE'||item.kind==='DIVISION_CHANGE'){await applyRole(member,p.from_role_id,'remove');await applyRole(member,p.discord_role_id,'add');await syncNickname(member,p)}
  else if(item.kind==='ACCESS_APPROVED'){await applyRole(member,p.rank_role_id,'add');await applyRole(member,p.division_role_id,'add');await syncNickname(member,p)}
  else if(item.kind==='FULL_SYNC'){const desired=new Set((p.desired_role_ids||[]).map(String));for(const r of (p.managed_role_ids||[])){const id=String(r);try{await applyRole(member,id,desired.has(id)?'add':'remove')}catch(e){console.warn('Cargo',id,e.message)}}await syncNickname(member,p)}
  else if(['MEDAL_ADD','COURSE_ADD','SPECIAL_ROLE_ADD'].includes(item.kind)){await applyRole(member,p.discord_role_id,'add')}
  else if(['MEDAL_REMOVE','COURSE_REMOVE','SPECIAL_ROLE_REMOVE'].includes(item.kind)){await applyRole(member,p.discord_role_id,'remove')}
  else if(item.kind==='MEMBER_DISMISSED'){for(const roleId of (p.managed_role_ids||[])){try{await applyRole(member,String(roleId),'remove')}catch(e){console.warn('Falha ao remover cargo',roleId,e.message)}}}
  if(item.kind==='ATTENDANCE_CHALLENGE'){
    const challengeId=String(p.challenge_id||'');if(!challengeId)throw new Error('Desafio de presença sem ID');
    const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`presence:${challengeId}`).setLabel('Confirmar presença').setStyle(ButtonStyle.Success));
    await safeDm(member,`**Centro de Gestão Interna**\n${p.dm_message||'Confirme sua presença para manter o ponto válido.'}`,[row]);
  }else if(p.dm_message||item.kind==='DM_NOTIFY') await safeDm(member,`**Centro de Gestão Interna**\n${p.dm_message||p.message||'Você possui uma nova atualização no Centro de Gestão Interna.'}`);
}
async function tick(){try{await api('/api/discord/attendance-due',{method:'POST',body:'{}'});const r=await api('/api/discord/queue');if(!r.ok)return;const {items=[]}=await r.json();for(const item of items){try{await processItem(item);await api('/api/discord/queue',{method:'POST',body:JSON.stringify({id:item.id,success:true})})}catch(e){lastError=String(e.message||e);await api('/api/discord/queue',{method:'POST',body:JSON.stringify({id:item.id,success:false,error:lastError})})}}}catch(e){lastError=String(e.message||e);console.error('poll',lastError)}}
async function processPosts(){try{const r=await api('/api/discord/posts');if(!r.ok)return;const {items=[],channels={}}=await r.json();for(const item of items){try{const channelId=channels[item.channel_key];if(!channelId)throw new Error(`Canal não configurado para ${item.channel_key}`);const guild=await client.guilds.fetch(DISCORD_GUILD_ID);const channel=await guild.channels.fetch(channelId);if(!channel||!channel.isTextBased())throw new Error('Canal inválido ou não textual');const p=item.payload||{};const embed=new EmbedBuilder().setTitle(String(p.title||'Centro de Gestão Interna').slice(0,256)).setDescription(String(p.description||'').slice(0,4000));if(Array.isArray(p.fields))embed.addFields(p.fields.slice(0,25).map(f=>({name:String(f.name||'Campo').slice(0,256),value:String(f.value||'—').slice(0,1024),inline:!!f.inline})));if(p.footer)embed.setFooter({text:String(p.footer).slice(0,2048)});embed.setTimestamp(new Date());const msg=await channel.send({embeds:[embed]});await api('/api/discord/posts',{method:'POST',body:JSON.stringify({id:item.id,success:true,discord_message_id:msg.id})})}catch(e){lastError=String(e.message||e);await api('/api/discord/posts',{method:'POST',body:JSON.stringify({id:item.id,success:false,error:lastError})})}}}catch(e){lastError=String(e.message||e);console.error('posts',lastError)}}
async function heartbeat(){try{await api('/api/discord/heartbeat',{method:'POST',body:JSON.stringify({bot_user_id:client.user?.id,bot_tag:client.user?.tag,guild_id:DISCORD_GUILD_ID,version:VERSION,latency_ms:Math.round(client.ws.ping||0),started_at:startedAt,last_error:lastError||null,metadata:{railway:true}})});lastError=''}catch(e){lastError=String(e.message||e)}}
async function registrationLink(discordId){const r=await api('/api/discord/registration-link',{method:'POST',body:JSON.stringify({discord_id:discordId})});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'Não foi possível gerar o link');return j.url}
async function runAudit(interaction){
  const guild=await client.guilds.fetch(DISCORD_GUILD_ID);
  await guild.members.fetch();
  const r=await api('/api/discord/audit-data');
  if(!r.ok)throw new Error('API de auditoria indisponível');
  const {members:site=[]}=await r.json();

  // A auditoria considera somente quem possui o cargo-base "Polícia Militar".
  // O ID é a forma recomendada; o fallback pelo nome existe só para facilitar a primeira configuração.
  let policeRole=null;
  if(DISCORD_POLICE_ROLE_ID) policeRole=guild.roles.cache.get(String(DISCORD_POLICE_ROLE_ID))||null;
  if(!policeRole){
    policeRole=guild.roles.cache.find(role=>['polícia militar','policia militar'].includes(String(role.name||'').trim().toLocaleLowerCase('pt-BR')))||null;
  }
  if(!policeRole) throw new Error('Cargo Polícia Militar não encontrado. Configure DISCORD_POLICE_ROLE_ID no Railway.');

  const siteByDiscord=new Map(site.filter(x=>x.discord_id).map(x=>[String(x.discord_id),x]));
  const guildPolice=[...guild.members.cache.values()].filter(m=>!m.user.bot&&m.roles.cache.has(policeRole.id));
  const policeIds=new Set(guildPolice.map(m=>m.id));
  const registered=[];const unregistered=[];const mismatches=[];

  for(const gm of guildPolice){
    const u=siteByDiscord.get(gm.id);
    if(u){
      registered.push(`${u.rank_name} ${u.game_name} - ${u.rg} | ${gm.user.tag}`);
      const expected=nickname(u.rank_name,u.game_name,u.rg);
      if(gm.nickname!==expected)mismatches.push(`${gm.user.tag} | atual: ${gm.nickname||gm.displayName} | esperado: ${expected}`);
    }else{
      unregistered.push(`${gm.user.tag} | ${gm.id}`);
    }
  }

  // Só apontamos como "fora do servidor/efetivo" contas aprovadas que não aparecem entre os membros PM auditados.
  const missing=site.filter(u=>u.discord_id&&!policeIds.has(String(u.discord_id))).map(u=>`${u.rank_name} ${u.game_name} - ${u.rg} | Discord ${u.discord_id}`);
  const text=[`AUDITORIA DO EFETIVO PM - ${new Date().toLocaleString('pt-BR')}`,'',`SERVIDOR: ${guild.name}`,`CARGO AUDITADO: ${policeRole.name}`,`MEMBROS COM POLÍCIA MILITAR: ${guildPolice.length}`,`CADASTRADOS NO SITE E PRESENTES: ${registered.length}`,`SEM CONTA NO SITE: ${unregistered.length}`,`CONTAS DO SITE FORA DO EFETIVO PM: ${missing.length}`,`APELIDO DIVERGENTE: ${mismatches.length}`,'','=== CADASTRADOS ===',...registered,'','=== PM SEM CONTA NO SITE ===',...unregistered,'','=== CONTA NO SITE / NÃO LOCALIZADO NO EFETIVO PM ===',...missing,'','=== APELIDOS DIVERGENTES ===',...mismatches].join('\n');
  await api('/api/discord/audit-result',{method:'POST',body:JSON.stringify({requested_by_discord_id:interaction.user.id,guild_member_count:guildPolice.length,registered_count:registered.length,unregistered_count:unregistered.length,missing_from_guild_count:missing.length,nickname_mismatch_count:mismatches.length,summary:{guild_name:guild.name,police_role_id:policeRole.id,police_role_name:policeRole.name}})});
  const embed=new EmbedBuilder().setTitle('Auditoria do Efetivo PM').setDescription(`Auditoria limitada aos membros com o cargo **${policeRole.name}**.`).addFields({name:'Efetivo auditado',value:String(guildPolice.length),inline:true},{name:'Com conta',value:String(registered.length),inline:true},{name:'Sem conta',value:String(unregistered.length),inline:true},{name:'Fora do efetivo',value:String(missing.length),inline:true},{name:'Nome divergente',value:String(mismatches.length),inline:true}).setTimestamp();
  const file=new AttachmentBuilder(Buffer.from(text,'utf8'),{name:`auditoria-pm-${Date.now()}.txt`});
  await interaction.editReply({embeds:[embed],files:[file]});
}
async function registerCommands(){
  const commands=[
    new SlashCommandBuilder().setName('perfil').setDescription('Mostra seu vínculo com o Centro de Gestão'),
    new SlashCommandBuilder().setName('verificar').setDescription('Verifica se seu Discord está cadastrado no sistema'),
    new SlashCommandBuilder().setName('registro').setDescription('Gera seu link seguro de cadastro no Centro de Gestão'),
    new SlashCommandBuilder().setName('painel').setDescription('Publica o painel de registro do Centro de Gestão').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('auditoria').setDescription('Compara o efetivo do Discord com as contas do site').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder().setName('sincronizar').setDescription('Sincroniza novamente um membro aprovado').addUserOption(o=>o.setName('membro').setDescription('Membro do Discord').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  ].map(c=>c.toJSON());
  const rest=new REST({version:'10'}).setToken(DISCORD_BOT_TOKEN);await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID,DISCORD_GUILD_ID),{body:commands});
}
client.on('interactionCreate',async i=>{
  if(i.isButton()&&i.customId.startsWith('presence:')){const challengeId=i.customId.slice('presence:'.length);await i.deferReply({ephemeral:true});try{const r=await api('/api/discord/attendance-confirm',{method:'POST',body:JSON.stringify({discord_id:i.user.id,challenge_id:challengeId})});const j=await r.json();await i.editReply(j.ok?'Presença confirmada com sucesso.':'Não foi possível confirmar: '+(j.error||'desafio expirado.'))}catch{await i.editReply('Não foi possível confirmar a presença agora.')}return}
  if(!i.isChatInputCommand())return;
  if(['perfil','verificar'].includes(i.commandName)){await i.deferReply({ephemeral:true});try{const r=await api(`/api/discord/member?discord_id=${i.user.id}`);if(!r.ok){await i.editReply('Seu Discord ID não está vinculado a nenhuma conta aprovada no Centro de Gestão. Use `/registro`.');return}const {member:m}=await r.json();const embed=new EmbedBuilder().setTitle('Centro de Gestão Interna').setDescription(`Vínculo identificado para **${m.game_name}**`).addFields({name:'Patente',value:m.rank_name||'—',inline:true},{name:'Divisão',value:m.division||'Sem divisão',inline:true},{name:'EXP',value:String(m.points||0),inline:true},{name:'Situação',value:m.inactive_flag?'Inativo sinalizado':m.status,inline:true}).setFooter({text:'Dados consultados diretamente no sistema'});await i.editReply({embeds:[embed]})}catch{await i.editReply('Não foi possível consultar o sistema agora.')}return}
  if(i.commandName==='registro'){await i.deferReply({ephemeral:true});try{const url=await registrationLink(i.user.id);const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Fazer meu registro'));await i.editReply({content:'Seu link é individual e expira em 15 minutos. O Discord ID será preenchido automaticamente.',components:[row]})}catch(e){await i.editReply(`Não foi possível gerar o cadastro: ${e.message}`)}return}
  if(i.commandName==='painel'){const url=`${SITE_URL.replace(/\/$/,'')}/register`;const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Abrir Centro de Gestão'));const embed=new EmbedBuilder().setTitle('Centro de Gestão Interna').setDescription('Acesso e cadastro destinados aos membros autorizados. Para um vínculo automático com seu Discord, use também o comando `/registro`.').setFooter({text:'Registro sujeito à aprovação administrativa'});await i.reply({embeds:[embed],components:[row]});return}
  if(i.commandName==='auditoria'){await i.deferReply({ephemeral:true});try{await runAudit(i)}catch(e){await i.editReply(`Falha na auditoria: ${e.message}`)}return}
  if(i.commandName==='sincronizar'){await i.deferReply({ephemeral:true});const target=i.options.getUser('membro',true);try{const r=await api('/api/discord/sync-request',{method:'POST',body:JSON.stringify({discord_id:target.id})});const j=await r.json();await i.editReply(r.ok&&j.ok?`Sincronização de **${j.member}** adicionada à fila.`:`Não foi possível sincronizar: ${j.error||'erro desconhecido'}`)}catch(e){await i.editReply(`Não foi possível sincronizar: ${e.message}`)}return}
});
client.once('ready',async()=>{console.log(`Bot online como ${client.user.tag}`);try{await registerCommands();console.log('Comandos registrados')}catch(e){lastError=String(e.message||e);console.error('commands',lastError)}setInterval(tick,POLL_MS);setInterval(processPosts,POLL_MS);setInterval(heartbeat,15000);tick();processPosts();heartbeat()});
client.login(DISCORD_BOT_TOKEN);
