# Bot Discord — Centro de Gestão PMERJ RP (V10)

Bot separado para hospedagem no Railway. Integra-se ao site via `SITE_URL` + `DISCORD_INTERNAL_SECRET`.

## Variáveis do Railway

```env
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
SITE_URL=https://seu-site.vercel.app
DISCORD_INTERNAL_SECRET=
DISCORD_POLICE_ROLE_ID=
DISCORD_COMMAND_ROLE_ID=
POLL_MS=10000
```

- `DISCORD_POLICE_ROLE_ID`: cargo **Polícia Militar**, usado para limitar a auditoria ao efetivo.
- `DISCORD_COMMAND_ROLE_ID`: cargo autorizado a usar comandos administrativos (ex.: Alto Comando). O site também pode fornecer essa configuração.
- `DISCORD_INTERNAL_SECRET`: deve ser exatamente igual ao valor da Vercel.

## Comandos

Comandos pessoais:
- `/registro`
- `/perfil`
- `/verificar`

Comandos administrativos (cargo configurado ou permissão administrativa):
- `/painel`
- `/auditoria`
- `/sincronizar`

O bot também processa automaticamente filas do site: promoções/rebaixamentos, cargos, divisões, cursos, medalhas, DMs, ações, apreensões, desligamentos e painel de ponto ao vivo quando configurado no site.

## Railway

Start command: `npm start`

O cargo do bot precisa ficar acima dos cargos que ele gerencia e ter as permissões necessárias de cargos/apelidos. Habilite o Server Members Intent no Discord Developer Portal para auditoria/sincronização do efetivo.
