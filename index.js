import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder,
  ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits, AttachmentBuilder,
  StringSelectMenuBuilder
} from 'discord.js';

const {DISCORD_BOT_TOKEN,DISCORD_GUILD_ID,SITE_URL,DISCORD_INTERNAL_SECRET,DISCORD_CLIENT_ID,DISCORD_POLICE_ROLE_ID,DISCORD_COMMAND_ROLE_ID}=process.env;
const POLL_MS=Math.max(5000,Number(process.env.POLL_MS||10000));
const VERSION='13.3.1';
if(!DISCORD_BOT_TOKEN||!DISCORD_GUILD_ID||!SITE_URL||!DISCORD_INTERNAL_SECRET||!DISCORD_CLIENT_ID) throw new Error('Variáveis do bot incompletas');
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
const startedAt=new Date().toISOString(); let lastError='';

async function api(path,opts={}){return fetch(`${SITE_URL.replace(/\/$/,'')}${path}`,{...opts,headers:{authorization:`Bearer ${DISCORD_INTERNAL_SECRET}`,'content-type':'application/json',...(opts.headers||{})}})}

let botConfigCache={value:null,at:0};
async function botConfig(){
  if(botConfigCache.value&&Date.now()-botConfigCache.at<60000)return botConfigCache.value;
  try{
    const r=await api('/api/discord/config');
    if(r.ok){const j=await r.json();botConfigCache={value:j,at:Date.now()};return j}
  }catch{}
  const fallback={command_role_id:String(DISCORD_COMMAND_ROLE_ID||''),police_role_id:String(DISCORD_POLICE_ROLE_ID||''),templates:{}};
  botConfigCache={value:fallback,at:Date.now()};return fallback;
}
async function commandRoleId(){const c=await botConfig();return String(c.command_role_id||DISCORD_COMMAND_ROLE_ID||'')}
async function policeRoleId(){const c=await botConfig();return String(c.police_role_id||DISCORD_POLICE_ROLE_ID||'')}
function templateColor(v,fallback=0x0B4E7A){if(!v)return fallback;const s=String(v).replace('#','');const n=parseInt(s,16);return Number.isFinite(n)?n:fallback}
function tpl(c,key){return c?.templates?.[key]||{}}
function componentEmoji(value,fallback){const s=String(value||fallback||'').trim();const m=s.match(/^<(a?):([^:]+):(\d+)>$/);if(m)return {id:m[3],name:m[2],animated:m[1]==='a'};return {name:s||String(fallback||'•')}}
function renderTemplate(value,ctx={}){
  return String(value??'').replace(/\{([a-zA-Z0-9_]+)\}/g,(all,key)=>{
    const v=ctx[key];
    return v===undefined||v===null?all:String(v);
  });
}
function emojiText(template,key,fallback=''){
  return String(template?.option_emojis?.[key]||fallback||'').trim();
}
function labelText(template,key,fallback=''){
  return String(template?.option_labels?.[key]||fallback||'').trim();
}
function registrationReviewEmbed(c,app,status='PENDING',reviewer=''){
  const x=tpl(c,'police_registration_review');
  const em=x.option_emojis||{};
  const colors={
    PENDING:templateColor(x.color,0x0B4E7A),
    APPROVED:0x178B61,
    REJECTED:0xB53A45
  };

  const embed=new EmbedBuilder()
    .setColor(colors[status]||colors.PENDING);

  applyTemplateVisual(
    embed,
    x,
    {
      member:app.game_name,
      rg:app.rg,
      interviewer:
        app.interviewer_name||
        `<@${app.interviewer_discord_id}>`,
      requester:
        app.requested_by_name||
        `<@${app.requested_by_discord_id}>`,
      status,
      reviewer
    }
  );

  if(!x.title){
    embed.setTitle(
      `${String(em.register||'📋')} Análise de Registro Policial`
    );
  }

  if(!x.description){
    embed.setDescription(
      status==='PENDING'
        ? 'Um novo registro policial foi enviado para análise.'
        : status==='APPROVED'
          ? 'Registro aprovado e acesso criado.'
          : 'Registro recusado.'
    );
  }

  embed.addFields(
    {
      name:`${String(em.member||'👮')} Nome policial`,
      value:String(app.game_name),
      inline:true
    },
    {
      name:`${String(em.rg||'🪪')} RG`,
      value:String(app.rg),
      inline:true
    },
    {
      name:'Discord',
      value:`<@${app.discord_id}>`,
      inline:true
    },
    {
      name:`${String(em.interviewer||'🎙️')} Entrevistador`,
      value:
        app.interviewer_name
          ? `${app.interviewer_name} • <@${app.interviewer_discord_id}>`
          : `<@${app.interviewer_discord_id}>`,
      inline:false
    },
    {
      name:`${String(em.requester||'🧾')} Registrado por`,
      value:
        app.requested_by_name
          ? `${app.requested_by_name} • <@${app.requested_by_discord_id}>`
          : `<@${app.requested_by_discord_id}>`,
      inline:false
    },
    {
      name:'Situação',
      value:
        status==='PENDING'
          ? '🟡 Aguardando análise'
          : status==='APPROVED'
            ? `✅ Aprovado${reviewer?` por ${reviewer}`:''}`
            : `❌ Recusado${reviewer?` por ${reviewer}`:''}`,
      inline:false
    }
  ).setTimestamp();

  return embed;
}

function registrationDecisionRow(c,applicationId,disabled=false){
  const x=tpl(c,'police_registration_review');
  const em=x.option_emojis||{};

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `police-reg-approve:${applicationId}`
      )
      .setLabel(
        labelText(
          x,
          'approve',
          'Aprovar registro'
        )
      )
      .setEmoji(
        componentEmoji(
          em.approve,
          '✅'
        )
      )
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(
        `police-reg-reject:${applicationId}`
      )
      .setLabel(
        labelText(
          x,
          'reject',
          'Recusar registro'
        )
      )
      .setEmoji(
        componentEmoji(
          em.reject,
          '❌'
        )
      )
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function policeRegistrationPanelPayload(c){
  const x=tpl(c,'police_registration_panel');
  const em=x.option_emojis||{};

  const embed=new EmbedBuilder()
    .setColor(templateColor(x.color,0x0B4E7A));

  applyTemplateVisual(embed,x,{});

  if(!x.title){
    embed.setTitle(
      `${String(em.register||'📋')} Registro Policial`
    );
  }

  if(!x.description){
    embed.setDescription(
      'Use o menu abaixo para iniciar seu registro policial.\n\n'+
      'Tenha em mãos:\n'+
      `${String(em.name||'👤')} Nome do jogo\n`+
      `${String(em.rg||'🪪')} RG do jogo\n`+
      `${String(em.interviewer||'🎙️')} Entrevistador responsável`
    );
  }

  const menu=new StringSelectMenuBuilder()
    .setCustomId('police-registration-menu')
    .setPlaceholder(
      labelText(
        x,
        'placeholder',
        'Selecione uma opção'
      )
    )
    .addOptions({
      label:labelText(
        x,
        'start',
        'Iniciar registro policial'
      ),
      value:'START',
      description:'Abrir formulário de registro',
      emoji:componentEmoji(
        em.register,
        '📋'
      )
    });

  return {
    embeds:[embed],
    components:[
      new ActionRowBuilder().addComponents(menu)
    ]
  };
}


function configuredMessage(c,key,fallback,ctx={}){
  const x=tpl(c,key);
  const base=x.message_content||fallback||'';
  const emojiCtx={...ctx};
  for(const [k,v] of Object.entries(x.option_emojis||{})){
    emojiCtx[`emoji_${k}`]=String(v);
  }
  return renderTemplate(base,emojiCtx);
}
function applyTemplateVisual(embed,x,ctx={}){
  const emojiCtx={...ctx};
  for(const [k,v] of Object.entries(x?.option_emojis||{})){
    emojiCtx[`emoji_${k}`]=String(v);
  }
  if(x?.title)embed.setTitle(renderTemplate(x.title,emojiCtx).slice(0,256));
  if(x?.description)embed.setDescription(renderTemplate(x.description,emojiCtx).slice(0,4000));
  if(x?.footer)embed.setFooter({text:renderTemplate(x.footer,emojiCtx).slice(0,2048)});
  if(x?.image_url)embed.setImage(String(x.image_url));
  if(x?.thumbnail_url)embed.setThumbnail(String(x.thumbnail_url));
  return embed;
}
function dmTemplateKey(kind){
  const map={
    ACCESS_APPROVED:'access_approved_dm',
    RANK_CHANGE:'rank_change_dm',
    DIVISION_CHANGE:'division_change_dm',
    MEDAL_ADD:'medal_dm',
    COURSE_ADD:'course_dm',
    FULL_SYNC:'sync_dm',
    DM_ONLY:'absence_dm',
    MEMBER_DISMISSED:'dismissed_dm',
    DM_NOTIFY:'generic_dm'
  };
  return map[String(kind||'')]||'generic_dm';
}
function postTemplateKey(sourceType){
  const map={
    ACTION:'action_post',
    SEIZURE:'seizure_post',
    PUNISHMENT:'discipline_post',
    DISCIPLINE:'discipline_post',
    DISMISSAL:'dismissal_post',
    PROMOTION:'promotion_post',
    DEMOTION:'demotion_post',
    COMPLAINT:'complaint_post',
    PUBLIC_COMPLAINT:'complaint_post',
    ATTENDANCE_START:'attendance_start',
    ATTENDANCE_OVERTIME:'attendance_overtime',
    ATTENDANCE_END:'attendance_end'
  };
  return map[String(sourceType||'')]||'action_post';
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
  const c=await botConfig();
  const content=configuredMessage(
    c,
    'access_denied',
    '🔒 Este comando é restrito ao Alto Comando/administradores autorizados.'
  );
  if(!interaction.deferred&&!interaction.replied){
    await interaction.reply({content,ephemeral:true});
  }else{
    await interaction.editReply(content);
  }
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
    if(p.sync_avatar){
      const avatarUrl=member.user.displayAvatarURL({extension:'png',size:256});
      try{await api('/api/discord/avatar-sync',{method:'POST',body:JSON.stringify({user_id:item.user_id,discord_id:member.id,avatar_url:avatarUrl})})}catch(e){console.warn('avatar sync',e.message)}
    }
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
  else if(item.kind==='PASSWORD_RESET_APPROVED'){
    const c=await botConfig();const x=tpl(c,'password_reset');
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`password-reset:${p.request_id}:${p.confirmation_token}`)
        .setLabel(labelText(x,'button','Confirmar nova senha'))
        .setStyle(ButtonStyle.Primary)
    );
    const content=configuredMessage(
      c,
      'password_reset',
      p.dm_message||'🔐 Sua recuperação de senha foi aprovada. Confirme abaixo.',
      {message:p.dm_message||''}
    );
    const delivered=await safeDm(member,content,[row]);
    if(!delivered)throw new Error('Não foi possível enviar a confirmação no privado do membro.');
  }
  if(item.kind==='ATTENDANCE_CHALLENGE'){
    const challengeId=String(p.challenge_id||'');if(!challengeId)throw new Error('Confirmação de ponto sem ID');
    const c=await botConfig();const x=tpl(c,'attendance_confirm');const em=x.option_emojis||{};
    const menu=new StringSelectMenuBuilder().setCustomId(`attendance-confirm:${challengeId}`).setPlaceholder('Selecione como deseja prosseguir').addOptions(
      {label:labelText(x,'end','Sair de serviço'),description:'Confirma o ciclo e encerra o turno',value:'END',emoji:componentEmoji(em.end,'✅')},
      {label:labelText(x,'continue','Continuar em serviço'),description:'Confirma e inicia um novo ciclo de 1 hora',value:'OVERTIME',emoji:componentEmoji(em.continue,'➕')}
    );
    const row=new ActionRowBuilder().addComponents(menu);
    const embed=new EmbedBuilder().setColor(templateColor(x.color,0xD6A931));
    applyTemplateVisual(embed,x,{
      cycle:Number(p.cycle_no||1),
      message:p.dm_message||'',
      description:p.dm_message||x.description||''
    });
    if(!x.title)embed.setTitle(`⏱️ Confirmação de Serviço • ${Number(p.cycle_no||1)}h`);
    if(p.dm_message&&!x.description)embed.setDescription(p.dm_message);
    embed.addFields({
      name:`${String(em.pending||'⚠️')} Sem resposta`,
      value:String(x.field_overrides?.pending||'O ponto continua aberto e o tempo adicional fica salvo como divergente.'),
      inline:false
    }).setTimestamp();
    if(x.image_url)embed.setImage(String(x.image_url));if(x.thumbnail_url)embed.setThumbnail(String(x.thumbnail_url));
    try{await member.send({embeds:[embed],components:[row]})}catch{throw new Error('Não foi possível enviar a confirmação no privado do membro.')}
  }else if(item.kind!=='PASSWORD_RESET_APPROVED'&&(p.dm_message||p.message||item.kind==='DM_NOTIFY')){
    const c=await botConfig();
    const key=dmTemplateKey(item.kind);
    const original=String(
      p.dm_message||
      p.message||
      'Você possui uma nova atualização no Centro de Gestão Interna.'
    );
    const content=configuredMessage(
      c,
      key,
      '{message}',
      {
        message:original,
        member:p.game_name||member.displayName||member.user.username,
        rank:p.rank_name||'',
        division:p.division_name||p.division||'',
        from:p.from||'',
        to:p.to||'',
        name:p.name||''
      }
    );
    await safeDm(member,content);
  }
}
async function tick(){try{await api('/api/discord/attendance-due',{method:'POST',body:'{}'});const r=await api('/api/discord/queue');if(!r.ok)return;const {items=[]}=await r.json();for(const item of items){try{await processItem(item);await api('/api/discord/queue',{method:'POST',body:JSON.stringify({id:item.id,success:true})})}catch(e){lastError=String(e.message||e);await api('/api/discord/queue',{method:'POST',body:JSON.stringify({id:item.id,success:false,error:lastError})})}}}catch(e){lastError=String(e.message||e);console.error('poll',lastError)}}
async function processPosts(){
  try{
    const r=await api('/api/discord/posts');
    if(!r.ok)return;

    const {items=[],channels={}}=await r.json();
    const c=await botConfig();

    for(const item of items){
      try{
        const channelId=channels[item.channel_key];
        if(!channelId){
          throw new Error(
            `Canal não configurado para ${item.channel_key}`
          );
        }

        const guild=await client.guilds.fetch(
          DISCORD_GUILD_ID
        );

        const channel=await guild.channels.fetch(
          channelId
        );

        if(!channel||!channel.isTextBased()){
          throw new Error(
            'Canal inválido ou não textual'
          );
        }

        const p=item.payload||{};
        const key=postTemplateKey(item.source_type);
        const x=tpl(c,key);
        const em=x.option_emojis||{};

        const fallbackColors={
          ACTION:0x1B6FA8,
          SEIZURE:0x0E8E9D,
          PUNISHMENT:0xB5394C,
          DISCIPLINE:0xB5394C,
          DISMISSAL:0x7C2636,
          PROMOTION:0x198D62,
          DEMOTION:0xB96B16,
          COMPLAINT:0x8E5AB5,
          PUBLIC_COMPLAINT:0x8E5AB5,
          ATTENDANCE_START:0x178B61,
          ATTENDANCE_END:0xB53A45,
          ATTENDANCE_OVERTIME:0x267BC5
        };

        const ctx={
          title:String(p.title||'Relatório PMERJ'),
          description:String(p.description||'Sem descrição.'),
          footer:String(
            p.footer||
            'Polícia Militar do Estado do Rio de Janeiro - Reduto Online'
          ),
          source_type:String(item.source_type||''),
          source_id:String(item.source_id||''),
          xp:String(p.xp_reward||0)
        };

        const authorEmoji=emojiText(
          x,
          'author',
          '🛡️'
        );

        const embed=new EmbedBuilder()
          .setColor(
            templateColor(
              x.color,
              fallbackColors[item.source_type]||0x1B6FA8
            )
          )
          .setAuthor({
            name:`${authorEmoji} PMERJ • Centro de Gestão`,
            ...(guild.iconURL?.()
              ? {iconURL:guild.iconURL()}
              : {})
          });

        applyTemplateVisual(
          embed,
          x,
          ctx
        );

        if(!x.title){
          embed.setTitle(ctx.title.slice(0,256));
        }

        if(!x.description){
          embed.setDescription(
            ctx.description.slice(0,4000)
          );
        }

        if(Array.isArray(p.fields)){
          const pretty=p.fields
            .slice(0,25)
            .map(f=>({
              name:String(
                x.field_overrides?.[String(f.name||'')]||
                f.name||
                'Informação'
              ).slice(0,256),
              value:String(f.value||'—').slice(0,1024),
              inline:!!f.inline
            }));

          embed.addFields(pretty);
        }

        if(p.xp_reward){
          embed.addFields({
            name:`${emojiText(x,'xp','✦')} EXP da atividade`,
            value:`+${p.xp_reward} EXP por participante`,
            inline:true
          });
        }

        if(p.occurred_at){
          embed.addFields({
            name:`${emojiText(x,'date','🕒')} Data do registro`,
            value:`<t:${Math.floor(new Date(p.occurred_at).getTime()/1000)}:f>`,
            inline:true
          });
        }

        if(
          p.author_avatar&&
          /^https?:\/\//i.test(String(p.author_avatar))&&
          !x.thumbnail_url
        ){
          embed.setThumbnail(
            String(p.author_avatar)
          );
        }

        if(!x.footer&&p.footer){
          embed.setFooter({
            text:String(p.footer).slice(0,2048)
          });
        }

        embed.setTimestamp(new Date());

        const images=Array.isArray(p.images)
          ? p.images
              .filter(url=>
                /^https?:\/\//i.test(String(url))
              )
              .slice(0,3)
          : [];

        if(images[0]&&!x.image_url){
          embed.setImage(String(images[0]));
        }

        const embeds=[embed];

        for(const url of images.slice(1)){
          embeds.push(
            new EmbedBuilder()
              .setColor(
                templateColor(
                  x.color,
                  fallbackColors[item.source_type]||0x1B6FA8
                )
              )
              .setImage(String(url))
          );
        }

        const msg=await channel.send({embeds});

        await api(
          '/api/discord/posts',
          {
            method:'POST',
            body:JSON.stringify({
              id:item.id,
              success:true,
              discord_message_id:msg.id
            })
          }
        );
      }catch(e){
        lastError=String(e.message||e);

        await api(
          '/api/discord/posts',
          {
            method:'POST',
            body:JSON.stringify({
              id:item.id,
              success:false,
              error:lastError
            })
          }
        );
      }
    }
  }catch(e){
    lastError=String(e.message||e);
    console.error('posts',lastError);
  }
}

async function updateAttendancePanel(){
  try{
    const r=await api('/api/discord/attendance-panel');
    if(!r.ok)return;

    const d=await r.json();
    if(!d.ok||!d.channel_id)return;

    const c=await botConfig();
    const x=tpl(c,'attendance_live_panel');
    const em=x.option_emojis||{};

    const guild=await client.guilds.fetch(
      DISCORD_GUILD_ID
    );

    const channel=await guild.channels.fetch(
      String(d.channel_id)
    );

    if(!channel||!channel.isTextBased()){
      throw new Error(
        'Canal do painel de ponto inválido ou não textual'
      );
    }

    const active=Array.isArray(d.active)
      ? d.active
      : [];

    const lines=active
      .slice(0,20)
      .map((member,index)=>{
        const min=Math.floor(
          Number(member.credited_seconds||0)/60
        );

        const mode=
          member.mode==='COMPAT'
            ? `${emojiText(x,'light','☁️')} Leve`
            : `${emojiText(x,'normal_mode','🌐')} Normal`;

        const bar=
          '▰'.repeat(
            Math.min(5,Math.floor(min/12))
          )+
          '▱'.repeat(
            Math.max(
              0,
              5-Math.min(5,Math.floor(min/12))
            )
          );

        return (
          `**${String(index+1).padStart(2,'0')}. `+
          `${member.rank_name} ${member.game_name}**\n`+
          `${bar}  ${min} min • ${mode}`+
          `${member.division?' • '+member.division:''}`
        );
      });

    const ctx={
      active_lines:
        lines.length
          ? lines.join('\n\n')
          : '> Nenhum membro está com ponto aberto no momento.'
    };

    const embed=new EmbedBuilder()
      .setColor(templateColor(x.color,0x155F8D))
      .setAuthor({
        name:`${emojiText(x,'online','🟢')} PMERJ • Centro de Gestão`,
        ...(guild.iconURL?.()
          ? {iconURL:guild.iconURL()}
          : {})
      });

    applyTemplateVisual(embed,x,ctx);

    if(!x.title){
      embed.setTitle(
        `${emojiText(x,'online','🟢')} EFETIVO EM SERVIÇO`
      );
    }

    if(!x.description){
      embed.setDescription(ctx.active_lines);
    }

    embed.addFields(
      {
        name:`${emojiText(x,'member','👮')} Em serviço`,
        value:`**${d.active_count||0}**`,
        inline:true
      },
      {
        name:`${emojiText(x,'effective','🏛️')} Efetivo`,
        value:`**${d.effective||0}**`,
        inline:true
      },
      {
        name:`${emojiText(x,'goal','⏱️')} Meta`,
        value:`**${Math.round(Number(d.daily_seconds||3600)/60)} min**`,
        inline:true
      }
    ).setTimestamp(new Date());

    let msg=null;

    if(d.message_id){
      try{
        msg=await channel.messages.fetch(
          String(d.message_id)
        );

        await msg.edit({embeds:[embed]});
      }catch{
        msg=null;
      }
    }

    if(!msg){
      msg=await channel.send({embeds:[embed]});
    }

    if(
      String(d.message_id||'')!==
      String(msg.id)
    ){
      await api(
        '/api/discord/attendance-panel',
        {
          method:'POST',
          body:JSON.stringify({
            channel_id:String(d.channel_id),
            message_id:String(msg.id)
          })
        }
      );
    }
  }catch(e){
    lastError=String(e.message||e);
    console.error(
      'attendance-panel',
      lastError
    );
  }
}

async function upsertCenterPanel(forceChannel=null){
  const r=await api('/api/discord/system-panel');
  if(!r.ok)throw new Error('API do painel indisponível');

  const d=await r.json();
  const channelId=String(
    forceChannel||d.channel_id||''
  );

  if(!channelId)return null;

  const c=await botConfig();
  const x=tpl(c,'system_panel');

  const guild=await client.guilds.fetch(
    DISCORD_GUILD_ID
  );

  const channel=await guild.channels.fetch(
    channelId
  );

  if(!channel?.isTextBased()){
    throw new Error('Canal do Centro inválido');
  }

  let health={
    ok:false,
    database:'ERROR',
    latency_ms:0
  };

  try{
    const hr=await fetch(
      `${SITE_URL.replace(/\/$/,'')}/api/system/health`,
      {cache:'no-store'}
    );
    health=await hr.json();
  }catch{}

  const healthDescription=
    health.ok
      ? `${emojiText(x,'ok','🟢')} **Sistema operacional**\nDados consultados em tempo real.`
      : `${emojiText(x,'error','🔴')} **Sistema indisponível ou degradado**`;

  const embed=new EmbedBuilder()
    .setColor(
      templateColor(
        x.color,
        health.ok?0x1595D3:0xC43D4B
      )
    )
    .setAuthor({
      name:`${emojiText(x,'shield','🛡️')} PMERJ • Centro de Gestão`,
      ...(guild.iconURL()
        ? {iconURL:guild.iconURL()}
        : {})
    });

  applyTemplateVisual(
    embed,
    x,
    {
      health_description:healthDescription
    }
  );

  if(!x.title){
    embed.setTitle(
      `${emojiText(x,'shield','🛡️')} CENTRO DE GESTÃO • STATUS AO VIVO`
    );
  }

  if(!x.description){
    embed.setDescription(healthDescription);
  }

  embed.addFields(
    {
      name:`${emojiText(x,'site','🌐')} Site`,
      value:health.ok?'ONLINE':'INDISPONÍVEL',
      inline:true
    },
    {
      name:`${emojiText(x,'database','🗄️')} Banco`,
      value:String(health.database||'ERRO'),
      inline:true
    },
    {
      name:`${emojiText(x,'bot','🤖')} Bot`,
      value:'ONLINE',
      inline:true
    },
    {
      name:`${emojiText(x,'latency','⚡')} Latência`,
      value:`${health.latency_ms||0} ms`,
      inline:true
    },
    {
      name:`${emojiText(x,'member','👮')} Efetivo`,
      value:String(d.effective||0),
      inline:true
    },
    {
      name:`${emojiText(x,'service','🟢')} Em serviço`,
      value:String(d.active||0),
      inline:true
    },
    {
      name:`${emojiText(x,'action','🚔')} Ações`,
      value:String(d.actions||0),
      inline:true
    },
    {
      name:`${emojiText(x,'seizure','📦')} Apreensões`,
      value:String(d.seizures||0),
      inline:true
    },
    {
      name:`${emojiText(x,'complaint','🛡️')} Casos Corregedoria`,
      value:String(d.complaints||0),
      inline:true
    }
  ).setTimestamp();

  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(SITE_URL)
      .setLabel(
        labelText(
          x,
          'open',
          'Acessar Centro de Gestão'
        )
      ),
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(
        `${SITE_URL.replace(/\/$/,'')}/register`
      )
      .setLabel(
        labelText(
          x,
          'register',
          'Realizar registro'
        )
      )
  );

  let msg=null;

  if(d.message_id&&!forceChannel){
    try{
      msg=await channel.messages.fetch(
        String(d.message_id)
      );

      await msg.edit({
        embeds:[embed],
        components:[row]
      });
    }catch{}
  }

  if(!msg){
    msg=await channel.send({
      embeds:[embed],
      components:[row]
    });
  }

  await api(
    '/api/discord/system-panel',
    {
      method:'POST',
      body:JSON.stringify({
        channel_id:channelId,
        message_id:msg.id
      })
    }
  );

  return msg;
}

async function upsertPublicPanel(forceChannel=null){
  const r=await api('/api/discord/public-panel');
  if(!r.ok)throw new Error('API do Portal indisponível');

  const d=await r.json();
  const channelId=String(
    forceChannel||d.public_channel_id||''
  );

  if(!channelId)return null;

  const c=await botConfig();
  const x=tpl(c,'public_portal');

  const guild=await client.guilds.fetch(
    DISCORD_GUILD_ID
  );

  const channel=await guild.channels.fetch(
    channelId
  );

  if(!channel?.isTextBased()){
    throw new Error('Canal do Portal inválido');
  }

  const embed=new EmbedBuilder()
    .setColor(templateColor(x.color,0x0B4F8A));

  applyTemplateVisual(embed,x,{});

  if(!x.title){
    embed.setTitle(
      `${emojiText(x,'portal','🏛️')} PMERJ WEBSITE`
    );
  }

  if(!x.description){
    embed.setDescription(
      'O nosso **website** é a plataforma de gestão e atendimento da Polícia Militar do Estado do Rio de Janeiro - Reduto Online.'
    );
  }

  if(
    d.public_top_image_url&&
    !x.thumbnail_url
  ){
    embed.setThumbnail(d.public_top_image_url);
  }

  if(
    d.public_bottom_image_url&&
    !x.image_url
  ){
    embed.setImage(d.public_bottom_image_url);
  }

  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(SITE_URL)
      .setLabel(
        labelText(
          x,
          'open',
          'Acessar o Portal'
        )
      )
  );

  let msg=null;

  if(d.public_message_id&&!forceChannel){
    try{
      msg=await channel.messages.fetch(
        String(d.public_message_id)
      );

      await msg.edit({
        embeds:[embed],
        components:[row]
      });
    }catch{}
  }

  if(!msg){
    msg=await channel.send({
      embeds:[embed],
      components:[row]
    });
  }

  await api(
    '/api/discord/public-panel',
    {
      method:'POST',
      body:JSON.stringify({
        channel_id:channelId,
        message_id:msg.id
      })
    }
  );

  return msg;
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
  const c=await botConfig();const x=tpl(c,'audit');const em=x.option_emojis||{};const embed=new EmbedBuilder().setColor(templateColor(x.color,0x0B4E7A));applyTemplateVisual(embed,x,{police_role:policeRole.name});if(!x.title)embed.setTitle(`${String(em.audit||'🔎')} Auditoria do Efetivo PM`);if(!x.description)embed.setDescription(`Auditoria limitada aos membros com o cargo **${policeRole.name}**.`);embed.addFields({name:`${String(em.effective||'👮')} Efetivo auditado`,value:String(guildPolice.length),inline:true},{name:`${String(em.registered||'✅')} Com conta`,value:String(registered.length),inline:true},{name:`${String(em.unregistered||'⚠️')} Sem conta`,value:String(unregistered.length),inline:true},{name:`${String(em.missing||'❌')} Fora do efetivo`,value:String(missing.length),inline:true},{name:`${String(em.nickname||'📝')} Nome divergente`,value:String(mismatches.length),inline:true}).setTimestamp();
  const file=new AttachmentBuilder(Buffer.from(text,'utf8'),{name:`auditoria-pm-${Date.now()}.txt`});
  await interaction.editReply({embeds:[embed],files:[file]});
}

async function attendancePanelPayload(){
  const c=await botConfig();
  const x=tpl(c,'attendance_panel');
  const em=x.option_emojis||{};

  const menu=new StringSelectMenuBuilder()
    .setCustomId('attendance-menu')
    .setPlaceholder(
      labelText(
        x,
        'placeholder',
        'Selecione uma opção'
      )
    )
    .addOptions(
      {
        label:labelText(x,'start','Iniciar turno'),
        value:'START',
        description:'Entrar em serviço',
        emoji:componentEmoji(em.start,'🟢')
      },
      {
        label:labelText(x,'stop','Encerrar turno'),
        value:'STOP',
        description:'Sair de serviço',
        emoji:componentEmoji(em.stop,'🔴')
      },
      {
        label:labelText(x,'hours','Consultar minhas horas'),
        value:'STATUS',
        description:'Horas normais, extras e divergentes',
        emoji:componentEmoji(em.hours,'⏱️')
      },
      {
        label:labelText(x,'overtime','Hora extra'),
        value:'OVERTIME',
        description:'Consultar/liberar hora extra após a confirmação',
        emoji:componentEmoji(em.overtime,'➕')
      },
      {
        label:labelText(x,'history','Meu histórico'),
        value:'HISTORY',
        description:'Últimos registros por data',
        emoji:componentEmoji(em.history,'📅')
      },
      {
        label:labelText(x,'rules','Regras do ponto'),
        value:'RULES',
        description:'Consultar as regras do bate-ponto',
        emoji:componentEmoji(em.rules,'📖')
      }
    );

  const embed=new EmbedBuilder()
    .setColor(templateColor(x.color));

  applyTemplateVisual(
    embed,
    x,
    {}
  );

  if(!x.title){
    embed.setTitle(
      `${emojiText(x,'panel','📋')} Central de Serviço`
    );
  }

  if(!x.description){
    embed.setDescription(
      'Controle seu turno pelo menu abaixo. O site e o Discord usam o mesmo registro de ponto.'
    );
  }

  embed.addFields(
    {
      name:`${emojiText(x,'pending','🔔')} Confirmação`,
      value:String(
        x.field_overrides?.confirmation||
        'A cada 1 hora, exclusivamente no privado do bot.'
      ),
      inline:true
    },
    {
      name:`${emojiText(x,'divergent','⚠️')} Divergentes`,
      value:String(
        x.field_overrides?.divergent||
        'Tempo acumulado enquanto uma confirmação estiver pendente.'
      ),
      inline:true
    }
  ).setTimestamp();

  return {
    embeds:[embed],
    components:[
      new ActionRowBuilder().addComponents(menu)
    ]
  };
}
function fmtDuration(sec){sec=Math.max(0,Number(sec||0));return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`}
async function handleAttendanceMenu(i,value){
  await i.deferReply({ephemeral:true});

  try{
    const c=await botConfig();

    if(value==='RULES'){
      const x=tpl(c,'attendance_rules');
      const embed=new EmbedBuilder()
        .setColor(templateColor(x.color));

      applyTemplateVisual(embed,x,{});

      if(!x.title){
        embed.setTitle(
          `${emojiText(x,'rules','📖')} Regras do Bate-Ponto`
        );
      }

      if(!x.description){
        embed.setDescription(
          '• Abra o ponto somente em patrulhamento, operação policial ou atividade operacional autorizada.\n'+
          '• Encerre o turno ao finalizar a atividade.\n'+
          '• A confirmação é enviada no Discord a cada 1h.\n'+
          '• Sem confirmação, o tempo adicional vira **hora divergente**.\n'+
          '• Hora extra começa somente após a confirmação que autoriza continuar.'
        );
      }

      await i.editReply({embeds:[embed]});
      return;
    }

    if(value==='HISTORY'){
      const r=await api(
        `/api/discord/attendance-history?discord_id=${i.user.id}`
      );

      const j=await r.json();

      if(!r.ok||!j.ok){
        await i.editReply(
          configuredMessage(
            c,
            'command_error',
            '❌ {message}',
            {
              message:
                j.error||
                'Não foi possível consultar.'
            }
          )
        );
        return;
      }

      const x=tpl(c,'attendance_history');
      const em=x.option_emojis||{};

      const lines=(j.rows||[])
        .slice(0,10)
        .map(row=>
          `**${new Date(row.local_day).toLocaleDateString('pt-BR')}** • `+
          `${String(em.normal||'✅')} ${fmtDuration(row.normal)} • `+
          `${String(em.overtime||'➕')} ${fmtDuration(row.overtime)} • `+
          `${String(em.divergent||'⚠️')} ${fmtDuration(row.divergent)}`
        );

      const embed=new EmbedBuilder()
        .setColor(templateColor(x.color));

      applyTemplateVisual(
        embed,
        x,
        {
          member:j.member,
          history_lines:
            lines.length
              ? lines.join('\n')
              : 'Nenhum turno registrado.'
        }
      );

      if(!x.title){
        embed.setTitle(
          `${emojiText(x,'history','📅')} Histórico • ${j.member}`
        );
      }

      if(!x.description){
        embed.setDescription(
          lines.length
            ? lines.join('\n')
            : 'Nenhum turno registrado.'
        );
      }

      await i.editReply({embeds:[embed]});
      return;
    }

    const r=await api(
      '/api/discord/attendance-action',
      {
        method:'POST',
        body:JSON.stringify({
          discord_id:i.user.id,
          action:value
        })
      }
    );

    const j=await r.json();

    if(value==='STATUS'&&r.ok&&j.ok){
      const x=tpl(c,'attendance_status');
      const em=x.option_emojis||{};

      const statusText=
        j.active
          ? `${String(em.online||'🟢')} **EM SERVIÇO**`
          : `${String(em.offline||'⚪')} **FORA DE SERVIÇO**`;

      const embed=new EmbedBuilder()
        .setColor(
          templateColor(
            x.color,
            j.active?0x178B61:0x415A66
          )
        );

      applyTemplateVisual(
        embed,
        x,
        {
          member:j.member,
          status_text:statusText
        }
      );

      if(!x.title){
        embed.setTitle(
          `${String(em.hours||'⏱️')} ${j.member}`
        );
      }

      if(!x.description){
        embed.setDescription(statusText);
      }

      embed.addFields(
        {
          name:`${String(em.normal||'✅')} Normal`,
          value:fmtDuration(j.normal),
          inline:true
        },
        {
          name:`${String(em.overtime||'➕')} Extra`,
          value:fmtDuration(j.overtime),
          inline:true
        },
        {
          name:`${String(em.divergent||'⚠️')} Divergente`,
          value:fmtDuration(j.divergent),
          inline:true
        },
        {
          name:'Confirmação',
          value:
            j.pending_confirmation
              ? `${String(em.pending||'🟡')} Pendente no privado`
              : 'Sem pendência',
          inline:false
        }
      );

      await i.editReply({embeds:[embed]});
      return;
    }

    const message=
      j.message||
      j.error||
      (
        r.ok
          ? 'Operação concluída.'
          : 'Não foi possível concluir.'
      );

    await i.editReply(
      configuredMessage(
        c,
        r.ok&&j.ok
          ? 'command_success'
          : 'command_error',
        r.ok&&j.ok
          ? '✅ {message}'
          : '❌ {message}',
        {message}
      )
    );
  }catch(e){
    const c=await botConfig();

    await i.editReply(
      configuredMessage(
        c,
        'command_error',
        '❌ Falha ao acessar o ponto: {message}',
        {message:e.message}
      )
    );
  }
}
async function registerCommands(){
  const commands=[
    new SlashCommandBuilder().setName('perfil').setDescription('Mostra seu vínculo com o Centro de Gestão'),
    new SlashCommandBuilder().setName('verificar').setDescription('Verifica se seu Discord está cadastrado no sistema'),
    new SlashCommandBuilder().setName('registro').setDescription('Gera seu link seguro de cadastro no Centro de Gestão'),
    new SlashCommandBuilder()
      .setName('painelregistro')
      .setDescription('Publica/atualiza o painel de registro policial neste canal'),
    new SlashCommandBuilder().setName('painel').setDescription('Publica o painel de registro do Centro de Gestão'),
    new SlashCommandBuilder().setName('painelponto').setDescription('Publica a Central de Serviço com menu de ponto'),
    new SlashCommandBuilder().setName('centro').setDescription('Publica/atualiza o painel operacional do Centro de Gestão'),
    new SlashCommandBuilder().setName('portal').setDescription('Publica/atualiza o painel público Portal PMERJ'),
    new SlashCommandBuilder().setName('auditoria').setDescription('Compara o efetivo do Discord com as contas do site'),
    new SlashCommandBuilder().setName('sincronizar').setDescription('Sincroniza novamente um membro aprovado').addUserOption(o=>o.setName('membro').setDescription('Membro do Discord').setRequired(true))
  ].map(c=>c.toJSON());
  const rest=new REST({version:'10'}).setToken(DISCORD_BOT_TOKEN);await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID,DISCORD_GUILD_ID),{body:commands});
}
client.on('interactionCreate',async i=>{
  if(
    i.isStringSelectMenu()&&
    i.customId==='police-registration-menu'
  ){
    const choice=String(i.values[0]||'');

    if(choice!=='START'){
      return;
    }

    const modal=new ModalBuilder()
      .setCustomId('police-registration-modal')
      .setTitle('Registro Policial');

    const nameInput=new TextInputBuilder()
      .setCustomId('game_name')
      .setLabel('Nome do jogo')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(40)
      .setPlaceholder('Ex.: Erick Walker');

    const rgInput=new TextInputBuilder()
      .setCustomId('rg')
      .setLabel('RG do jogo')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(40)
      .setPlaceholder('Ex.: 554');

    const interviewerInput=new TextInputBuilder()
      .setCustomId('interviewer')
      .setLabel('ID ou @ do entrevistador')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(60)
      .setPlaceholder('Cole o ID do Discord do entrevistador');

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(rgInput),
      new ActionRowBuilder().addComponents(interviewerInput)
    );

    await i.showModal(modal);
    return;
  }

  if(i.isStringSelectMenu()&&i.customId==='attendance-menu'){await handleAttendanceMenu(i,String(i.values[0]||'STATUS'));return}
  if(i.isStringSelectMenu()&&i.customId.startsWith('attendance-confirm:')){
    const challengeId=i.customId.slice('attendance-confirm:'.length);
    const decision=String(i.values[0]||'END');
    await i.deferReply({ephemeral:true});
    try{
      const c=await botConfig();
      const r=await api('/api/discord/attendance-confirm',{
        method:'POST',
        body:JSON.stringify({
          discord_id:i.user.id,
          challenge_id:challengeId,
          decision
        })
      });
      const j=await r.json();
      const message=r.ok&&j.ok
        ? (
            decision==='OVERTIME'
              ? 'Confirmado. Você continua em serviço; a próxima confirmação será em 1 hora. A divergência acumulada foi preservada.'
              : 'Serviço encerrado.'
          )
        : (
            j.error||
            'Não foi possível confirmar.'
          );
      await i.editReply(
        configuredMessage(
          c,
          r.ok&&j.ok?'command_success':'command_error',
          r.ok&&j.ok?'✅ {message}':'❌ {message}',
          {message}
        )
      );
    }catch(e){
      const c=await botConfig();
      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ Falha: {message}',
          {message:e.message}
        )
      );
    }
    return;
  }
  if(
    i.isModalSubmit()&&
    i.customId==='police-registration-modal'
  ){
    await i.deferReply({ephemeral:true});

    try{
      const gameName=String(
        i.fields.getTextInputValue(
          'game_name'
        )||''
      ).trim();

      const rg=String(
        i.fields.getTextInputValue(
          'rg'
        )||''
      ).trim();

      const interviewerRaw=String(
        i.fields.getTextInputValue(
          'interviewer'
        )||''
      ).trim();

      const interviewerId=
        (
          interviewerRaw.match(/\d{15,22}/)||
          []
        )[0]||'';

      if(!interviewerId){
        throw new Error(
          'Informe o ID do Discord do entrevistador.'
        );
      }

      const guild=await client.guilds.fetch(
        DISCORD_GUILD_ID
      );

      let interviewerMember=null;

      try{
        interviewerMember=
          await guild.members.fetch(
            interviewerId
          );
      }catch{}

      if(!interviewerMember){
        throw new Error(
          'Não encontrei o entrevistador neste servidor.'
        );
      }

      const r=await api(
        '/api/discord/police-registration/create',
        {
          method:'POST',
          body:JSON.stringify({
            discord_id:i.user.id,
            game_name:gameName,
            rg,
            interviewer_discord_id:
              interviewerMember.id,
            interviewer_name:
              interviewerMember.displayName||
              interviewerMember.user.username,
            requested_by_discord_id:
              i.user.id,
            requested_by_name:
              i.member?.displayName||
              i.user.globalName||
              i.user.username
          })
        }
      );

      const j=await r.json();

      if(!r.ok||!j.ok){
        throw new Error(
          j.error||
          'Não foi possível enviar o registro.'
        );
      }

      const c=await botConfig();

      const channel=await guild.channels.fetch(
        String(
          j.settings.analysis_channel_id||''
        )
      );

      if(!channel?.isTextBased()){
        throw new Error(
          'O canal de análise configurado é inválido.'
        );
      }

      const embed=registrationReviewEmbed(
        c,
        j.application,
        'PENDING'
      );

      const row=registrationDecisionRow(
        c,
        j.application.id
      );

      const msg=await channel.send({
        embeds:[embed],
        components:[row]
      });

      try{
        const dbPayload={
          application_id:j.application.id,
          source_message_id:msg.id
        };
      }catch{}

      await i.editReply(
        configuredMessage(
          c,
          'police_registration_submitted',
          '✅ Registro enviado para análise. Aguarde a decisão da administração.',
          {
            member:gameName,
            rg
          }
        )
      );
    }catch(e){
      const c=await botConfig();

      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ {message}',
          {
            message:
              'Não foi possível enviar o registro: '+
              e.message
          }
        )
      );
    }

    return;
  }

  if(
    i.isButton()&&
    (
      i.customId.startsWith('police-reg-approve:')||
      i.customId.startsWith('police-reg-reject:')
    )
  ){
    if(!(await guardAdminCommand(i)))return;

    await i.deferReply({ephemeral:true});

    const approve=
      i.customId.startsWith(
        'police-reg-approve:'
      );

    const applicationId=
      i.customId.split(':')[1]||'';

    try{
      const c=await botConfig();

      const r=await api(
        '/api/discord/police-registration/decision',
        {
          method:'POST',
          body:JSON.stringify({
            application_id:applicationId,
            decision:
              approve
                ? 'APPROVE'
                : 'REJECT',
            approver_discord_id:
              i.user.id
          })
        }
      );

      const j=await r.json();

      if(!r.ok||!j.ok){
        throw new Error(
          j.error||
          'Não foi possível analisar o registro.'
        );
      }

      const reviewer=
        i.user.globalName||
        i.user.username;

      if(!approve){
        const app=j.application;

        try{
          const guild=await client.guilds.fetch(
            DISCORD_GUILD_ID
          );

          const member=await guild.members.fetch(
            String(app.discord_id)
          );

          const x=tpl(
            c,
            'police_registration_rejected_dm'
          );

          const content=configuredMessage(
            c,
            'police_registration_rejected_dm',
            '❌ Seu registro policial não foi aprovado. {note}',
            {
              member:app.game_name,
              rg:app.rg,
              note:''
            }
          );

          await safeDm(member,content);
        }catch{}

        await i.message.edit({
          embeds:[
            registrationReviewEmbed(
              c,
              app,
              'REJECTED',
              reviewer
            )
          ],
          components:[
            registrationDecisionRow(
              c,
              applicationId,
              true
            )
          ]
        });

        await i.editReply(
          configuredMessage(
            c,
            'command_success',
            '✅ {message}',
            {
              message:
                'Registro recusado.'
            }
          )
        );

        return;
      }

      const guild=await client.guilds.fetch(
        DISCORD_GUILD_ID
      );

      const member=await guild.members.fetch(
        String(j.user.discord_id)
      );

      let rolesApplied=true;
      let roleError='';

      try{
        const removeIds=
          Array.isArray(j.remove_rank_role_ids)
            ? j.remove_rank_role_ids
            : [];

        for(const roleId of removeIds){
          if(
            member.roles.cache.has(
              String(roleId)
            )
          ){
            await member.roles.remove(
              String(roleId),
              'Registro policial aprovado'
            );
          }
        }

        for(const roleId of j.role_ids||[]){
          if(
            roleId&&
            !member.roles.cache.has(
              String(roleId)
            )
          ){
            await member.roles.add(
              String(roleId),
              'Registro policial aprovado'
            );
          }
        }

        const nick=
          `${j.user.rank_name} `+
          `${j.user.game_name} - `+
          `${j.user.rg}`;

        try{
          await member.setNickname(
            nick.slice(0,32),
            'Registro policial aprovado'
          );
        }catch{}
      }catch(e){
        rolesApplied=false;
        roleError=String(e.message||e);
      }

      try{
        await api(
          '/api/discord/police-registration/role-result',
          {
            method:'POST',
            body:JSON.stringify({
              application_id:applicationId,
              success:rolesApplied,
              error:roleError
            })
          }
        );
      }catch{}

      const x=tpl(
        c,
        'police_registration_approved_dm'
      );

      const dmContent=configuredMessage(
        c,
        'police_registration_approved_dm',
        '🔑 **Seu acesso foi criado.**\nRG: `{rg}`\nToken temporário: `{token}`\n\nUse esse token como senha no primeiro acesso. Você será obrigado a criar uma nova senha imediatamente.',
        {
          member:j.user.game_name,
          rg:j.user.rg,
          token:j.token,
          rank:j.user.rank_name,
          expiry_hours:
            j.token_expiry_hours
        }
      );

      const loginButton=
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setURL(
              `${SITE_URL.replace(/\/$/,'')}/login`
            )
            .setLabel(
              labelText(
                x,
                'login',
                'Abrir Centro de Gestão'
              )
            )
        );

      const delivered=await safeDm(
        member,
        dmContent,
        [loginButton]
      );

      await i.message.edit({
        embeds:[
          registrationReviewEmbed(
            c,
            j.application,
            'APPROVED',
            reviewer
          )
        ],
        components:[
          registrationDecisionRow(
            c,
            applicationId,
            true
          )
        ]
      });

      const resultMessage=[
        `Registro de **${j.user.game_name}** aprovado.`,
        delivered
          ? 'Token enviado no privado.'
          : '⚠️ Não consegui enviar DM ao membro.',
        rolesApplied
          ? 'Cargos aplicados.'
          : `⚠️ Falha ao aplicar cargos: ${roleError}`
      ].join('\n');

      await i.editReply(
        configuredMessage(
          c,
          rolesApplied&&delivered
            ? 'command_success'
            : 'command_error',
          rolesApplied&&delivered
            ? '✅ {message}'
            : '⚠️ {message}',
          {message:resultMessage}
        )
      );
    }catch(e){
      const c=await botConfig();

      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ {message}',
          {
            message:
              'Falha na análise: '+e.message
          }
        )
      );
    }

    return;
  }

  if(i.isButton()&&i.customId.startsWith('password-reset:')){
    await i.deferReply({ephemeral:true});
    try{
      const c=await botConfig();
      const parts=i.customId.split(':');
      const requestId=parts[1]||'';
      const token=parts.slice(2).join(':');
      const r=await api('/api/discord/password-reset-confirm',{
        method:'POST',
        body:JSON.stringify({
          request_id:requestId,
          token,
          discord_id:i.user.id
        })
      });
      const j=await r.json();
      const message=j.ok
        ? 'Sua senha foi atualizada. Todas as sessões antigas do site foram encerradas.'
        : 'Não foi possível alterar: '+(j.error||'confirmação inválida.');
      await i.editReply(
        configuredMessage(
          c,
          j.ok?'command_success':'command_error',
          j.ok?'✅ {message}':'❌ {message}',
          {message}
        )
      );
    }catch{
      const c=await botConfig();
      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ {message}',
          {message:'Não foi possível concluir a recuperação agora.'}
        )
      );
    }
    return;
  }
  if(!i.isChatInputCommand())return;
  if(['perfil','verificar'].includes(i.commandName)){
    await i.deferReply({ephemeral:true});
    try{
      const c=await botConfig();
      const r=await api(`/api/discord/member?discord_id=${i.user.id}`);

      if(!r.ok){
        await i.editReply(
          configuredMessage(
            c,
            'command_error',
            '❌ {message}',
            {
              message:'Seu Discord ID não está vinculado a nenhuma conta aprovada no Centro de Gestão. Use /registro.'
            }
          )
        );
        return;
      }

      const {member:m}=await r.json();
      const x=tpl(c,'member_profile');
      const em=x.option_emojis||{};

      const embed=new EmbedBuilder()
        .setColor(templateColor(x.color,0x1595D3))
        .setAuthor({
          name:'PMERJ • Centro de Gestão'
        });

      applyTemplateVisual(
        embed,
        x,
        {
          member:m.game_name,
          rank:m.rank_name||'—',
          division:m.division||'Sem divisão',
          xp:String(m.points||0),
          status:m.status
        }
      );

      if(!x.title){
        embed.setTitle(
          `${String(em.profile||'👤')} ${m.game_name}`
        );
      }

      if(!x.description){
        embed.setDescription(
          `${String(em.link||'✅')} **Discord vinculado ao Centro de Gestão**`
        );
      }

      embed.addFields(
        {
          name:`${String(em.rank||'🎖️')} Patente`,
          value:m.rank_name||'—',
          inline:true
        },
        {
          name:`${String(em.division||'🏢')} Divisão`,
          value:m.division||'Sem divisão',
          inline:true
        },
        {
          name:`${String(em.xp||'✨')} EXP`,
          value:String(m.points||0),
          inline:true
        },
        {
          name:`${String(em.status||'🛡️')} Situação`,
          value:
            m.inactive_flag
              ? `${String(em.inactive||'⚠️')} Inativo sinalizado`
              : m.status,
          inline:true
        },
        {
          name:`${String(em.discord||'🔗')} Discord`,
          value:`<@${i.user.id}>`,
          inline:true
        }
      ).setTimestamp();

      await i.editReply({embeds:[embed]});
    }catch{
      const c=await botConfig();
      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ {message}',
          {message:'Não foi possível consultar o sistema agora.'}
        )
      );
    }
    return;
  }
  if(i.commandName==='painelregistro'){
    if(!(await guardAdminCommand(i)))return;

    await i.deferReply({ephemeral:true});

    try{
      const c=await botConfig();
      const payload=policeRegistrationPanelPayload(c);

      const r=await api(
        '/api/discord/police-registration/panel'
      );

      const old=await r.json().catch(()=>({}));

      let msg=null;

      if(
        r.ok&&
        old.message_id&&
        old.channel_id===i.channelId
      ){
        try{
          msg=await i.channel.messages.fetch(
            String(old.message_id)
          );
          await msg.edit(payload);
        }catch{
          msg=null;
        }
      }

      if(!msg){
        msg=await i.channel.send(payload);
      }

      await api(
        '/api/discord/police-registration/panel',
        {
          method:'POST',
          body:JSON.stringify({
            channel_id:i.channelId,
            message_id:msg.id
          })
        }
      );

      await i.editReply(
        configuredMessage(
          c,
          'command_success',
          '✅ {message}',
          {
            message:
              'Painel de registro policial publicado/atualizado neste canal.'
          }
        )
      );
    }catch(e){
      const c=await botConfig();
      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ {message}',
          {
            message:
              'Não foi possível publicar o painel: '+
              e.message
          }
        )
      );
    }

    return;
  }

  if(i.commandName==='registro'){
    await i.deferReply({ephemeral:true});

    try{
      const c=await botConfig();
      const x=tpl(c,'registration_link');
      const roleId=await policeRoleId();

      if(!roleId){
        throw new Error(
          'O cargo Polícia Militar ainda não foi configurado no Centro de Gestão.'
        );
      }

      if(!i.member?.roles?.cache?.has?.(roleId)){
        throw new Error(
          'Você não possui o cargo de Polícia Militar necessário para realizar o registro.'
        );
      }

      const url=await registrationLink(i.user.id);

      const row=new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL(url)
          .setLabel(
            labelText(
              x,
              'button',
              'Fazer meu registro'
            )
          )
      );

      await i.editReply({
        content:configuredMessage(
          c,
          'registration_link',
          '🔗 Seu link é individual e expira em 15 minutos. O Discord ID será preenchido automaticamente.'
        ),
        components:[row]
      });
    }catch(e){
      const c=await botConfig();

      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ Não foi possível gerar o cadastro: {message}',
          {message:e.message}
        )
      );
    }

    return;
  }
  if(i.commandName==='centro'){
    if(!(await guardAdminCommand(i)))return;
    await i.deferReply({ephemeral:true});
    try{
      const c=await botConfig();
      await upsertCenterPanel(i.channelId);
      await i.editReply(
        configuredMessage(
          c,
          'command_success',
          '✅ {message}',
          {message:'Painel do Centro de Gestão publicado/atualizado neste canal.'}
        )
      );
    }catch(e){
      const c=await botConfig();
      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ {message}',
          {message:'Falha: '+e.message}
        )
      );
    }
    return;
  }
  if(i.commandName==='portal'){
    if(!(await guardAdminCommand(i)))return;
    await i.deferReply({ephemeral:true});
    try{
      const c=await botConfig();
      await upsertPublicPanel(i.channelId);
      await i.editReply(
        configuredMessage(
          c,
          'command_success',
          '✅ {message}',
          {message:'Portal público publicado/atualizado neste canal.'}
        )
      );
    }catch(e){
      const c=await botConfig();
      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ {message}',
          {message:'Falha: '+e.message}
        )
      );
    }
    return;
  }
  if(i.commandName==='painelponto'){
    if(!(await guardAdminCommand(i)))return;
    try{
      await i.reply(await attendancePanelPayload());
    }catch(e){
      if(!i.replied){
        const c=await botConfig();
        await i.reply({
          content:configuredMessage(
            c,
            'command_error',
            '❌ {message}',
            {message:'Falha: '+e.message}
          ),
          ephemeral:true
        });
      }
    }
    return;
  }
  if(i.commandName==='painel'){
    if(!(await guardAdminCommand(i)))return;

    const c=await botConfig();
    const x=tpl(c,'registration_panel');
    const url=`${SITE_URL.replace(/\/$/,'')}/register`;

    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(url)
        .setLabel(
          labelText(
            x,
            'button',
            'Abrir Centro de Gestão'
          )
        )
    );

    const embed=new EmbedBuilder()
      .setColor(templateColor(x.color,0x0B4E7A));

    applyTemplateVisual(embed,x,{});

    if(!x.title){
      embed.setTitle('Centro de Gestão Interna');
    }

    if(!x.description){
      embed.setDescription(
        'Acesso e cadastro destinados aos membros autorizados. Para um vínculo automático com seu Discord, use também o comando /registro.'
      );
    }

    await i.reply({
      embeds:[embed],
      components:[row]
    });

    return;
  }
  if(i.commandName==='auditoria'){
    if(!(await guardAdminCommand(i)))return;
    await i.deferReply({ephemeral:true});
    try{
      await runAudit(i);
    }catch(e){
      const c=await botConfig();
      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ {message}',
          {message:'Falha na auditoria: '+e.message}
        )
      );
    }
    return;
  }
  if(i.commandName==='sincronizar'){
    if(!(await guardAdminCommand(i)))return;
    await i.deferReply({ephemeral:true});
    const target=i.options.getUser('membro',true);
    try{
      const c=await botConfig();
      const r=await api('/api/discord/sync-request',{
        method:'POST',
        body:JSON.stringify({discord_id:target.id})
      });
      const j=await r.json();
      const ok=r.ok&&j.ok;
      const message=ok
        ? `Sincronização de **${j.member}** adicionada à fila.`
        : `Não foi possível sincronizar: ${j.error||'erro desconhecido'}`;
      await i.editReply(
        configuredMessage(
          c,
          ok?'command_success':'command_error',
          ok?'✅ {message}':'❌ {message}',
          {message}
        )
      );
    }catch(e){
      const c=await botConfig();
      await i.editReply(
        configuredMessage(
          c,
          'command_error',
          '❌ {message}',
          {message:'Não foi possível sincronizar: '+e.message}
        )
      );
    }
    return;
  }
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
      {
        const c=await botConfig();
        await safeDm(
          newMember,
          configuredMessage(
            c,
            'rank_guard',
            '⚠️ Foi detectado um cargo de patente incompatível com seu cadastro. A patente correta foi restaurada automaticamente.'
          )
        );
      }
    }
  }catch(e){console.warn('rank-guard',e.message)}
});

client.once('ready',async()=>{console.log(`Bot online como ${client.user.tag}`);try{await registerCommands();console.log('Comandos registrados')}catch(e){lastError=String(e.message||e);console.error('commands',lastError)}setInterval(tick,POLL_MS);setInterval(processPosts,POLL_MS);setInterval(heartbeat,15000);setInterval(updateAttendancePanel,20000);setInterval(()=>upsertCenterPanel().catch(e=>console.warn('center-panel',e.message)),30000);setInterval(()=>upsertPublicPanel().catch(e=>console.warn('public-panel',e.message)),300000);tick();processPosts();heartbeat();updateAttendancePanel();upsertCenterPanel().catch(()=>{});upsertPublicPanel().catch(()=>{})});
client.login(DISCORD_BOT_TOKEN);
