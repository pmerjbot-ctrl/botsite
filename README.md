# Bot Centro de Gestão — Railway V9

Este ZIP foi separado para você criar **outro repositório GitHub somente para o bot**.

Suba estes arquivos na raiz do novo repositório e conecte o repositório ao Railway.

## Variáveis do Railway

```env
DISCORD_BOT_TOKEN=TOKEN_DO_BOT
DISCORD_CLIENT_ID=ID_DA_APLICACAO
DISCORD_GUILD_ID=ID_DO_SERVIDOR
SITE_URL=https://SEU-SITE.vercel.app
DISCORD_INTERNAL_SECRET=O_MESMO_SEGREDO_CONFIGURADO_NA_VERCEL
POLL_MS=10000
```

O comando de start é `npm start`.

## Comandos

- `/perfil`
- `/verificar`
- `/registro`
- `/painel`
- `/auditoria`
- `/sincronizar @membro`

O bot envia heartbeat para o site a cada 15 segundos. No painel administrativo do site, a aba Discord mostra ONLINE enquanto o último heartbeat tiver menos de 60 segundos.

Para sincronizar apelidos e cargos, coloque o cargo do bot acima dos cargos administrados e habilite as permissões necessárias, inclusive gerenciamento de cargos/apelidos e o intent de membros.
