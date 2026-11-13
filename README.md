# Katana Duel - servidor online

Servidor de salas (WebSocket) para jogar Katana Duel online fora do artefato.

```
cd katana-duel
npm install
node server.js          # porta 8080 (use PORT=3000 para mudar)
```

Abra `http://SEU-IP:8080` em dois computadores (o servidor entrega o `katana-duel.html`
da pasta acima; use `GAME=/caminho/katana-duel.html` para outro local).
No menu: **JOGAR ONLINE > RANQUEADO / CRIAR SALA / ENTRAR EM SALA / PARTIDA RAPIDA**.

Para hospedar o HTML em outro lugar, abra-o com `?server=wss://seu-servidor`.
O anfitriao (criador da sala) roda a simulacao; o convidado envia teclas e recebe o estado.

## Contas e salvamento

Ao abrir o jogo aparece a tela **ENTRAR / CRIAR CONTA / JOGAR SEM CONTA**. A conta (usuario + senha, sem Google)
guarda lutadores liberados, pontuacao ranqueada e o melhor tempo do Boss Rush, para jogar em qualquer computador.
As senhas sao guardadas com scrypt + salt em `saves.json` (ou `SAVES=/caminho/saves.json`).
Nao precisa configurar nada alem de rodar `node server.js`.

## Salvar as contas para sempre (Render gratis)

O disco do Render gratis e apagado a cada deploy/reinicio, entao `saves.json` sozinho nao basta. O servidor ja sabe gravar
num banco gratuito **Upstash Redis** (sem cartao). Passo a passo:

1. Crie conta em https://upstash.com e clique em **Create Database** (Redis, plano Free, qualquer regiao).
2. Na pagina do banco, aba **REST API**, copie `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
3. No Render: seu Web Service > **Environment** > adicione as duas variaveis com esses valores e salve (o Render reinicia).
4. Nos logs deve aparecer `contas salvas no Upstash`. Pronto: toda conta criada fica guardada, mesmo apos novos deploys.

Se o Upstash estiver fora do ar na hora de ligar, o servidor se recusa a iniciar (e tenta de novo) para nunca sobrescrever as contas salvas.
Sem essas variaveis o servidor continua usando o arquivo local, como antes.

No Render gratis o disco e temporario (o `saves.json` some a cada deploy): para manter as contas, crie um **Disk**
e defina `SAVES=/data/saves.json`.

## Placares

O menu **JOGAR ONLINE > RANQUEADO > VER PLACAR** mostra o placar ranqueado; **ENTER** alterna para o
placar de **melhor tempo do Boss Rush**.

