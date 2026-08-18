import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits, AttachmentBuilder
} from 'discord.js';

const {DISCORD_BOT_TOKEN,DISCORD_GUILD_ID,SITE_URL,DISCORD_INTERNAL_SECRET,DISCORD_CLIENT_ID,DISCORD_POLICE_ROLE_ID,DISCORD_COMMAND_ROLE_ID}=process.env;
const POLL_MS=Math.max(5000,Number(process.env.POLL_MS||10000));
const VERSION='6.4.0-v12.4';
if(!DISCORD_BOT_TOKEN||!DISCORD_GUILD_ID||!SITE_URL||!DISCORD_INTERNAL_SECRET||!DISCORD_CLIENT_ID) throw new Error('Variáveis do bot incompletas');
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
const startedAt=new Date().toISOString(); let lastError='';

async function api(path,opts={}){return fetch(`${SITE_URL.replace(/\/$/,'')}${path}`,{...opts,headers:{authorization:`Bearer ${DISCORD_INTERNAL_SECRET}`,'content-type':'application/json',...(opts.headers||{})}})}

let commandRoleCache={id:String(DISCORD_COMMAND_ROLE_ID||''),at:0};
async function commandRoleId(){
  if(Date.now()-commandRoleCache.at<60000)return commandRoleCache.id;
  try{const r=await api('/api/discord/config');if(r.ok){const j=await r.json();commandRoleCache={id:String(j.command_role_id||DISCORD_COMMAND_ROLE_ID||''),at:Date.now()};return commandRoleCache.id}}catch{}
  commandRoleCache={id:String(DISCORD_COMMAND_ROLE_ID||''),at:Date.now()};return commandRoleCache.id;
}
async function canUseAdminCommand(interaction){
  if(!interaction.inGuild())return false;
  const member=interaction.member;
  if(member?.permissions?.has?.(PermissionFlagsBits.Administrator)||member?.permissions?.has?.(PermissionFlagsBits.ManageGuild))return true;
  const roleId=await commandRoleId();
  return !!roleId && !!member?.roles?.cache?.has?.(roleId);
}
async function guardAdminCommand(interaction){
  if(await canUseAdminCommand(interaction))return true;
  if(!interaction.deferred&&!interaction.replied)await interaction.reply({content:'🔒 Este comando é restrito ao Alto Comando/administradores autorizados.',ephemeral:true});
  else await interaction.editReply('🔒 Este comando é restrito ao Alto Comando/administradores autorizados.');
  return false;
}

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
  else if(item.kind==='LOGIN_ROLE_CHECK'){
    const rankRoles=Array.isArray(p.rank_roles)?p.rank_roles:[];
    const present=rankRoles.filter(r=>member.roles.cache.has(String(r.role_id)));
    const siteRank=String(p.site_rank||'');
    const siteRole=String(p.site_rank_role_id||rankRoles.find(r=>String(r.rank)===siteRank)?.role_id||'');
    if(present.length>1){
      for(const r of rankRoles){const id=String(r.role_id);try{await applyRole(member,id,id===siteRole?'add':'remove')}catch(e){console.warn('proteção patente',id,e.message)}}
      await syncNickname(member,{...p,rank_name:siteRank});
    }else if(present.length===1){
      const detected=String(present[0].rank||'');
      const detectedRole=String(present[0].role_id||'');
      if(['Recruta','Soldado'].includes(detected)&&detected!==siteRank){
        const rr=await api('/api/discord/login-rank-result',{method:'POST',body:JSON.stringify({user_id:item.user_id,detected_rank:detected})});
        if(!rr.ok)throw new Error('Site recusou ajuste automático de patente.');
        for(const r of rankRoles){const id=String(r.role_id);try{await applyRole(member,id,id===detectedRole?'add':'remove')}catch{}}
        await syncNickname(member,{...p,rank_name:detected});
      }else if(detected!==siteRank){
        try{await applyRole(member,detectedRole,'remove')}catch{}
        if(siteRole)await applyRole(member,siteRole,'add');
        await syncNickname(member,{...p,rank_name:siteRank});
      }else{
        for(const r of rankRoles){const id=String(r.role_id);if(id!==siteRole){try{await applyRole(member,id,'remove')}catch{}}}
        await syncNickname(member,{...p,rank_name:siteRank});
      }
    }else{
      if(siteRole)await applyRole(member,siteRole,'add');
      await syncNickname(member,{...p,rank_name:siteRank});
    }
  }
  else if(['MEDAL_ADD','COURSE_ADD','SPECIAL_ROLE_ADD'].includes(item.kind)){await applyRole(member,p.discord_role_id,'add')}
  else if(['MEDAL_REMOVE','COURSE_REMOVE','SPECIAL_ROLE_REMOVE'].includes(item.kind)){await applyRole(member,p.discord_role_id,'remove')}
  else if(item.kind==='MEMBER_DISMISSED'){for(const roleId of (p.managed_role_ids||[])){try{await applyRole(member,String(roleId),'remove')}catch(e){console.warn('Falha ao remover cargo',roleId,e.message)}}}
  else if(item.kind==='PASSWORD_RESET_APPROVED'){const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`password-reset:${p.request_id}:${p.confirmation_token}`).setLabel('Confirmar nova senha').setStyle(ButtonStyle.Primary));const delivered=await safeDm(member,p.dm_message||'Sua recuperação de senha foi aprovada. Confirme abaixo.',[row]);if(!delivered)throw new Error('Não foi possível enviar a confirmação no privado do membro.');}
  if(item.kind==='ATTENDANCE_CHALLENGE'){
    const challengeId=String(p.challenge_id||'');if(!challengeId)throw new Error('Confirmação final sem ID');
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`presence:${challengeId}`).setLabel('Confirmar e encerrar').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`presence-reject:${challengeId}`).setLabel('Continuar sem confirmar').setEmoji('⚠️').setStyle(ButtonStyle.Secondary)
    );
    const embed=new EmbedBuilder().setColor(0xD3A93A).setTitle('⏱️ Meta de serviço concluída').setDescription(p.dm_message||'Confirme para encerrar o ponto. Se continuar, o tempo adicional ficará separado como horas divergentes.').addFields({name:'✅ Horas normais',value:'A meta cumprida permanece registrada.',inline:true},{name:'⚠️ Horas divergentes',value:'Tempo adicional sem confirmação.',inline:true}).setFooter({text:'Polícia Militar do Estado do Rio de Janeiro - Reduto Online'}).setTimestamp();
    try{await member.send({embeds:[embed],components:[row]})}catch{throw new Error('Não foi possível enviar a confirmação final no privado do membro.')}
  }else if(item.kind!=='PASSWORD_RESET_APPROVED'&&(p.dm_message||item.kind==='DM_NOTIFY')) await safeDm(member,`**Centro de Gestão Interna**
${p.dm_message||p.message||'Você possui uma nova atualização no Centro de Gestão Interna.'}`);
}
async function tick(){try{await api('/api/discord/attendance-due',{method:'POST',body:'{}'});const r=await api('/api/discord/queue');if(!r.ok)return;const {items=[]}=await r.json();for(const item of items){try{await processItem(item);await api('/api/discord/queue',{method:'POST',body:JSON.stringify({id:item.id,success:true})})}catch(e){lastError=String(e.message||e);await api('/api/discord/queue',{method:'POST',body:JSON.stringify({id:item.id,success:false,error:lastError})})}}}catch(e){lastError=String(e.message||e);console.error('poll',lastError)}}
async function processPosts(){
  try{
    const r=await api('/api/discord/posts');if(!r.ok)return;
    const {items=[],channels={}}=await r.json();
    for(const item of items){
      try{
        const channelId=channels[item.channel_key];
        if(!channelId)throw new Error(`Canal não configurado para ${item.channel_key}`);
        const guild=await client.guilds.fetch(DISCORD_GUILD_ID);
        const channel=await guild.channels.fetch(channelId);
        if(!channel||!channel.isTextBased())throw new Error('Canal inválido ou não textual');
        const p=item.payload||{};
        const colors={ACTION:0x1B6FA8,SEIZURE:0x0E8E9D,PUNISHMENT:0xB5394C,DISMISSAL:0x7C2636,PROMOTION:0x198D62,DEMOTION:0xB96B16,COMPLAINT:0x8E5AB5,PUBLIC_COMPLAINT:0x8E5AB5};
        const icon=item.source_type==='ACTION'?'🚔':item.source_type==='SEIZURE'?'📦':item.source_type==='PUNISHMENT'?'⚠️':item.source_type==='PROMOTION'?'⬆️':item.source_type==='DEMOTION'?'⬇️':'🛡️';
        const embed=new EmbedBuilder()
          .setColor(colors[item.source_type]||0x1B6FA8)
          .setAuthor({name:`${icon} PMERJ • Centro de Gestão`,...(guild.iconURL?.()?{iconURL:guild.iconURL()}:{})})
          .setTitle(String(p.title||'Relatório PMERJ').slice(0,256))
          .setDescription(String(p.description||'Sem descrição.').slice(0,4000));

        if(Array.isArray(p.fields)){
          const pretty=p.fields.slice(0,25).map(f=>({
            name:String(f.name||'Informação').slice(0,256),
            value:String(f.value||'—').slice(0,1024),
            inline:!!f.inline
          }));
          embed.addFields(pretty);
        }
        if(p.xp_reward)embed.addFields({name:'✦ EXP da atividade',value:`+${p.xp_reward} EXP por participante`,inline:true});
        if(p.occurred_at)embed.addFields({name:'🕒 Data do registro',value:`<t:${Math.floor(new Date(p.occurred_at).getTime()/1000)}:f>`,inline:true});
        if(p.author_avatar&&/^https?:\/\//i.test(String(p.author_avatar)))embed.setThumbnail(String(p.author_avatar));
        if(p.footer)embed.setFooter({text:String(p.footer).slice(0,2048)});
        embed.setTimestamp(new Date());

        const images=Array.isArray(p.images)?p.images.filter(x=>/^https?:\/\//i.test(String(x))).slice(0,3):[];
        if(images[0])embed.setImage(String(images[0]));
        const embeds=[embed];
        for(const url of images.slice(1))embeds.push(new EmbedBuilder().setColor(colors[item.source_type]||0x1B6FA8).setImage(String(url)));
        const msg=await channel.send({embeds});
        await api('/api/discord/posts',{method:'POST',body:JSON.stringify({id:item.id,success:true,discord_message_id:msg.id})});
      }catch(e){
        lastError=String(e.message||e);
        await api('/api/discord/posts',{method:'POST',body:JSON.stringify({id:item.id,success:false,error:lastError})});
      }
    }
  }catch(e){lastError=String(e.message||e);console.error('posts',lastError)}
}

async function updateAttendancePanel(){
  try{
    const r=await api('/api/discord/attendance-panel');if(!r.ok)return;
    const d=await r.json();if(!d.ok||!d.channel_id)return;
    const guild=await client.guilds.fetch(DISCORD_GUILD_ID);const channel=await guild.channels.fetch(String(d.channel_id));if(!channel||!channel.isTextBased())throw new Error('Canal do painel de ponto inválido');
    const active=Array.isArray(d.active)?d.active:[];
    const lines=active.slice(0,20).map((x,i)=>{const normal=Math.floor(Number(x.normal_total??x.credited_seconds??0)/60),div=Math.floor(Number(x.divergent_seconds||0)/60);const status=x.awaiting_confirmation?'🟡 AGUARDANDO CONFIRMAÇÃO':'🟢 EM SERVIÇO';return `**${String(i+1).padStart(2,'0')}. ${x.rank_name} ${x.game_name}**\n${status} • ✅ ${normal} min normal${div>0?` • ⚠️ ${div} min divergente`:''} • ${x.mode==='COMPAT'?'☁️ Leve':'🌐 Normal'}`});
    const divergentCount=active.filter(x=>Number(x.divergent_seconds||0)>0).length;const waiting=active.filter(x=>x.awaiting_confirmation).length;
    const embed=new EmbedBuilder().setColor(waiting?0xD3A93A:0x155F8D).setAuthor({name:'PMERJ • Controle de Serviço',...(guild.iconURL?.()?{iconURL:guild.iconURL()}:{})}).setTitle('⏱️ PAINEL DE PONTO').setDescription(lines.length?lines.join('\n\n'):'> Nenhum membro está com ponto aberto no momento.').addFields({name:'👮 Em serviço',value:`**${d.active_count||0}**`,inline:true},{name:'🟡 Aguardando confirmação',value:`**${waiting}**`,inline:true},{name:'⚠️ Com divergência',value:`**${divergentCount}**`,inline:true},{name:'🏛️ Efetivo',value:`**${d.effective||0}**`,inline:true},{name:'🎯 Meta',value:`**${Math.round(Number(d.daily_seconds||3600)/60)} min**`,inline:true},{name:'🔔 Confirmação',value:'**Somente ao atingir a meta**',inline:true}).setFooter({text:'Polícia Militar do Estado do Rio de Janeiro - Reduto Online'}).setTimestamp(new Date());
    let msg=null;if(d.message_id){try{msg=await channel.messages.fetch(String(d.message_id));await msg.edit({embeds:[embed]})}catch{msg=null}}if(!msg)msg=await channel.send({embeds:[embed]});if(String(d.message_id||'')!==String(msg.id))await api('/api/discord/attendance-panel',{method:'POST',body:JSON.stringify({channel_id:String(d.channel_id),message_id:String(msg.id)})});
  }catch(e){lastError=String(e.message||e);console.error('attendance-panel',lastError)}
}

async function upsertCenterPanel(forceChannel=null){
  const r=await api('/api/discord/system-panel'); if(!r.ok)throw new Error('API do painel indisponível'); const d=await r.json();
  const channelId=String(forceChannel||d.channel_id||''); if(!channelId)return null; const guild=await client.guilds.fetch(DISCORD_GUILD_ID);const channel=await guild.channels.fetch(channelId);if(!channel?.isTextBased())throw new Error('Canal do Centro inválido');
  let health={ok:false,database:'ERROR',latency_ms:0};try{const hr=await fetch(`${SITE_URL.replace(/\/$/,'')}/api/system/health`,{cache:'no-store'});health=await hr.json()}catch{}
  const embed=new EmbedBuilder().setColor(health.ok?0x1595D3:0xC43D4B).setAuthor({name:'PMERJ • Centro de Gestão',...(guild.iconURL()?{iconURL:guild.iconURL()}: {})}).setTitle('🛡️ CENTRO DE GESTÃO • STATUS AO VIVO').setDescription(health.ok?'🟢 **Sistema operacional**\nDados consultados em tempo real.':'🔴 **Sistema indisponível ou degradado**').addFields({name:'🌐 Site',value:health.ok?'ONLINE':'INDISPONÍVEL',inline:true},{name:'🗄️ Banco',value:String(health.database||'ERRO'),inline:true},{name:'🤖 Bot',value:'ONLINE',inline:true},{name:'⚡ Latência',value:`${health.latency_ms||0} ms`,inline:true},{name:'👮 Efetivo',value:String(d.effective||0),inline:true},{name:'🟢 Em serviço',value:String(d.active||0),inline:true},{name:'🚔 Ações',value:String(d.actions||0),inline:true},{name:'📦 Apreensões',value:String(d.seizures||0),inline:true},{name:'🛡️ Casos Corregedoria',value:String(d.complaints||0),inline:true}).setFooter({text:'Atualização automática • Centro de Gestão'}).setTimestamp();
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(SITE_URL).setLabel('Acessar Centro de Gestão'),new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`${SITE_URL.replace(/\/$/,'')}/register`).setLabel('Realizar registro'));
  let msg=null;if(d.message_id&&!forceChannel){try{msg=await channel.messages.fetch(String(d.message_id));await msg.edit({embeds:[embed],components:[row]})}catch{}}
  if(!msg)msg=await channel.send({embeds:[embed],components:[row]});await api('/api/discord/system-panel',{method:'POST',body:JSON.stringify({channel_id:channelId,message_id:msg.id})});return msg;
}
async function upsertPublicPanel(forceChannel=null){
 const r=await api('/api/discord/public-panel');if(!r.ok)throw new Error('API do Portal indisponível');const d=await r.json();const channelId=String(forceChannel||d.public_channel_id||'');if(!channelId)return null;const guild=await client.guilds.fetch(DISCORD_GUILD_ID);const channel=await guild.channels.fetch(channelId);if(!channel?.isTextBased())throw new Error('Canal do Portal inválido');
 const portalEmbed=new EmbedBuilder().setColor(0x0B4F8A).setTitle('🏛️ PMERJ WEBSITE').setDescription('O nosso **website** é a plataforma de gestão e atendimento da Polícia Militar do Estado do Rio de Janeiro - Reduto Online, focada em duas funções públicas principais:\n\n• 🛡️ **Denúncias Anônimas**\n• 📋 **Recrutamento Oficial:** inscrições e informações sobre novos concursos e ingresso na corporação.').setFooter({text:'Polícia Militar do Estado do Rio de Janeiro - Reduto Online'});if(d.public_top_image_url)portalEmbed.setThumbnail(d.public_top_image_url);if(d.public_bottom_image_url)portalEmbed.setImage(d.public_bottom_image_url);const embeds=[portalEmbed];
 const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(SITE_URL).setLabel('Acessar o Portal'));
 let msg=null;if(d.public_message_id&&!forceChannel){try{msg=await channel.messages.fetch(String(d.public_message_id));await msg.edit({embeds,components:[row]})}catch{}}if(!msg)msg=await channel.send({embeds,components:[row]});await api('/api/discord/public-panel',{method:'POST',body:JSON.stringify({channel_id:channelId,message_id:msg.id})});return msg;
}
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
    new SlashCommandBuilder().setName('painel').setDescription('Publica o painel de registro do Centro de Gestão'),
    new SlashCommandBuilder().setName('centro').setDescription('Publica/atualiza o painel operacional do Centro de Gestão'),
    new SlashCommandBuilder().setName('portal').setDescription('Publica/atualiza o painel público Portal PMERJ'),
    new SlashCommandBuilder().setName('auditoria').setDescription('Compara o efetivo do Discord com as contas do site'),
    new SlashCommandBuilder().setName('sincronizar').setDescription('Sincroniza novamente um membro aprovado').addUserOption(o=>o.setName('membro').setDescription('Membro do Discord').setRequired(true))
  ].map(c=>c.toJSON());
  const rest=new REST({version:'10'}).setToken(DISCORD_BOT_TOKEN);await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID,DISCORD_GUILD_ID),{body:commands});
}
client.on('interactionCreate',async i=>{
  if(i.isButton()&&i.customId.startsWith('presence-reject:')){const challengeId=i.customId.slice('presence-reject:'.length);await i.deferReply({ephemeral:true});try{const r=await api('/api/discord/attendance-reject',{method:'POST',body:JSON.stringify({discord_id:i.user.id,challenge_id:challengeId})});const j=await r.json();await i.editReply(j.ok?'⚠️ Ponto mantido aberto. O tempo adicional será registrado como horas divergentes até você confirmar.':'Não foi possível registrar: '+(j.error||'erro desconhecido.'))}catch{await i.editReply('Não foi possível registrar sua decisão agora.')}return}
  if(i.isButton()&&i.customId.startsWith('presence:')){const challengeId=i.customId.slice('presence:'.length);await i.deferReply({ephemeral:true});try{const r=await api('/api/discord/attendance-confirm',{method:'POST',body:JSON.stringify({discord_id:i.user.id,challenge_id:challengeId})});const j=await r.json();await i.editReply(j.ok?`✅ Ponto confirmado e encerrado. Normal: ${Math.floor(Number(j.credited_seconds||0)/60)} min • Divergente: ${Math.floor(Number(j.divergent_seconds||0)/60)} min`:'Não foi possível confirmar: '+(j.error||'erro desconhecido.'))}catch{await i.editReply('Não foi possível confirmar o ponto agora.')}return}
  if(i.isButton()&&i.customId.startsWith('password-reset:')){await i.deferReply({ephemeral:true});try{const parts=i.customId.split(':');const requestId=parts[1]||'';const token=parts.slice(2).join(':');const r=await api('/api/discord/password-reset-confirm',{method:'POST',body:JSON.stringify({request_id:requestId,token,discord_id:i.user.id})});const j=await r.json();await i.editReply(j.ok?'✅ Sua senha foi atualizada. Todas as sessões antigas do site foram encerradas.':'❌ Não foi possível alterar: '+(j.error||'confirmação inválida.'))}catch{await i.editReply('❌ Não foi possível concluir a recuperação agora.')}return}
  if(!i.isChatInputCommand())return;
  if(['perfil','verificar'].includes(i.commandName)){await i.deferReply({ephemeral:true});try{const r=await api(`/api/discord/member?discord_id=${i.user.id}`);if(!r.ok){await i.editReply('Seu Discord ID não está vinculado a nenhuma conta aprovada no Centro de Gestão. Use `/registro`.');return}const {member:m}=await r.json();const embed=new EmbedBuilder().setColor(0x1595D3).setAuthor({name:'PMERJ • Centro de Gestão'}).setTitle(`👤 ${m.game_name}`).setDescription('✅ **Discord vinculado ao Centro de Gestão**').addFields({name:'🎖️ Patente',value:m.rank_name||'—',inline:true},{name:'🏢 Divisão',value:m.division||'Sem divisão',inline:true},{name:'✨ EXP',value:String(m.points||0),inline:true},{name:'🛡️ Situação',value:m.inactive_flag?'⚠️ Inativo sinalizado':m.status,inline:true},{name:'🔗 Discord',value:`<@${i.user.id}>`,inline:true}).setFooter({text:'Centro de Gestão • Dados consultados em tempo real'}).setTimestamp();await i.editReply({embeds:[embed]})}catch{await i.editReply('Não foi possível consultar o sistema agora.')}return}
  if(i.commandName==='registro'){await i.deferReply({ephemeral:true});try{const url=await registrationLink(i.user.id);const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Fazer meu registro'));await i.editReply({content:'Seu link é individual e expira em 15 minutos. O Discord ID será preenchido automaticamente.',components:[row]})}catch(e){await i.editReply(`Não foi possível gerar o cadastro: ${e.message}`)}return}
  if(i.commandName==='centro'){if(!(await guardAdminCommand(i)))return;await i.deferReply({ephemeral:true});try{await upsertCenterPanel(i.channelId);await i.editReply('✅ Painel do Centro de Gestão publicado/atualizado neste canal.')}catch(e){await i.editReply(`Falha: ${e.message}`)}return}
  if(i.commandName==='portal'){if(!(await guardAdminCommand(i)))return;await i.deferReply({ephemeral:true});try{await upsertPublicPanel(i.channelId);await i.editReply('✅ Portal público publicado/atualizado neste canal.')}catch(e){await i.editReply(`Falha: ${e.message}`)}return}
  if(i.commandName==='painel'){if(!(await guardAdminCommand(i)))return;const url=`${SITE_URL.replace(/\/$/,'')}/register`;const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Abrir Centro de Gestão'));const embed=new EmbedBuilder().setTitle('Centro de Gestão Interna').setDescription('Acesso e cadastro destinados aos membros autorizados. Para um vínculo automático com seu Discord, use também o comando `/registro`.').setFooter({text:'Registro sujeito à aprovação administrativa'});await i.reply({embeds:[embed],components:[row]});return}
  if(i.commandName==='auditoria'){if(!(await guardAdminCommand(i)))return;await i.deferReply({ephemeral:true});try{await runAudit(i)}catch(e){await i.editReply(`Falha na auditoria: ${e.message}`)}return}
  if(i.commandName==='sincronizar'){if(!(await guardAdminCommand(i)))return;await i.deferReply({ephemeral:true});const target=i.options.getUser('membro',true);try{const r=await api('/api/discord/sync-request',{method:'POST',body:JSON.stringify({discord_id:target.id})});const j=await r.json();await i.editReply(r.ok&&j.ok?`Sincronização de **${j.member}** adicionada à fila.`:`Não foi possível sincronizar: ${j.error||'erro desconhecido'}`)}catch(e){await i.editReply(`Não foi possível sincronizar: ${e.message}`)}return}
});

let rankMapCache={rows:[],at:0};
async function getRankMap(){
  if(Date.now()-rankMapCache.at<60000&&rankMapCache.rows.length)return rankMapCache.rows;
  try{const r=await api('/api/discord/rank-map');if(r.ok){const j=await r.json();rankMapCache={rows:Array.isArray(j.ranks)?j.ranks:[],at:Date.now()};return rankMapCache.rows}}catch{}
  return rankMapCache.rows;
}
client.on('guildMemberUpdate',async(oldMember,newMember)=>{
  try{
    if(newMember.user?.bot)return;
    const rankMap=await getRankMap();if(!rankMap.length)return;
    const rankRoleIds=new Set(rankMap.map(r=>String(r.role_id)));
    const changed=[...newMember.roles.cache.keys()].filter(id=>!oldMember.roles.cache.has(id)).some(id=>rankRoleIds.has(id));
    if(!changed)return;
    const mr=await api(`/api/discord/member?discord_id=${newMember.id}`);if(!mr.ok)return;
    const {member}=await mr.json();const siteRank=String(member.rank_name||'');
    const allowed=rankMap.find(r=>String(r.rank)===siteRank);
    const present=rankMap.filter(r=>newMember.roles.cache.has(String(r.role_id)));
    if(present.length>1||present.some(r=>String(r.rank)!==siteRank)){
      for(const r of rankMap){const id=String(r.role_id);try{await applyRole(newMember,id,allowed&&id===String(allowed.role_id)?'add':'remove')}catch{}}
      await syncNickname(newMember,{rank_name:siteRank,game_name:member.game_name,rg:member.rg});
      await safeDm(newMember,'Foi detectado um cargo de patente incompatível com seu cadastro. A patente correta foi restaurada automaticamente.');
    }
  }catch(e){console.warn('rank-guard',e.message)}
});

client.once('ready',async()=>{console.log(`Bot online como ${client.user.tag}`);try{await registerCommands();console.log('Comandos registrados')}catch(e){lastError=String(e.message||e);console.error('commands',lastError)}setInterval(tick,POLL_MS);setInterval(processPosts,POLL_MS);setInterval(heartbeat,15000);setInterval(updateAttendancePanel,20000);setInterval(()=>upsertCenterPanel().catch(e=>console.warn('center-panel',e.message)),30000);setInterval(()=>upsertPublicPanel().catch(e=>console.warn('public-panel',e.message)),300000);tick();processPosts();heartbeat();updateAttendancePanel();upsertCenterPanel().catch(()=>{});upsertPublicPanel().catch(()=>{})});
client.login(DISCORD_BOT_TOKEN);
