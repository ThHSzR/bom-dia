# Bom dia 🌹☕

Bot pessoal para enviar um GIF com legenda, uma vez por dia, para **um contato individual**, usando Node.js e Baileys no Termux. Funciona sem abrir a interface do WhatsApp ou simular toques.

**Esta é uma integração não oficial do WhatsApp, sem vínculo com a Meta. Pode deixar de funcionar e há risco de restrição ou bloqueio da conta.** Use com um contato que queira receber as mensagens. O projeto não usa a WhatsApp Business Platform.

## O que está implementado

- Vinculação por código ou QR; comandos de vinculação nunca enviam GIFs.
- Sessão e chaves salvas localmente, com gravação atômica e serializada.
- Horário diário, fuso IANA, destinatário e legenda configuráveis.
- Sorteio sem repetição até completar o ciclo, persistente entre reinícios.
- 40 legendas aleatórias com saudação e quebra de linha, em ciclo independente dos GIFs.
- Comparação por SHA-256: cópias idênticas ou arquivos renomeados não contam como GIFs novos.
- Conversão automática de `.gif` para MP4/H.264, enviado com `gifPlayback: true` e miniatura JPEG.
- Reconexão com espera progressiva; recuperação de horário perdido dentro de uma janela configurável.
- Histórico persistente, logs com rotação e trava para impedir duas instâncias no mesmo aparelho.
- Serviço runit com Termux:Boot e wake lock.

## Versões e requisitos

Verificado em **17/09/2026**: o registro npm publica `@whiskeysockets/baileys@7.0.0-rc14` como `latest`. É uma **release candidate**, fixada exatamente no `package.json`. O `package-lock.json` fixa também as dependências transitivas. Não troque por `latest` automaticamente.

Use **Node.js 22 ou superior**, FFmpeg com `libx264`, Android 7+ com pacotes atuais do Termux e acesso à internet. O próprio Baileys declara Node 20+, mas este projeto adota Node 22 como mínimo. A disponibilidade do Node atual também depende da arquitetura do aparelho; confirme com `node -v` e `npm test` nele. Android 5/6 não é alvo deste projeto.

A opção `legacy-peer-deps=true` em `.npmrc` evita instalar o peer nativo `sharp` no Android. Este bot gera miniaturas pelo FFmpeg e não usa recursos que dependam desses peers. Não há necessidade de Chromium, Rust instalado, root ou Termux:API.

## 1. Instalar no celular

### Cenário: celular principal e Android antigo

- **Celular principal:** continua com seu WhatsApp e seu número normalmente. É nele que você autoriza a vinculação.
- **Android antigo:** executa o bot no Termux, com acesso à internet. Não precisa instalar o WhatsApp nele, transferir a conta ou colocar um chip só para o bot; pode usar Wi-Fi.
- As mensagens saem pela conta vinculada do celular principal, para o contato configurado em `recipientNumber`.

Confira a versão em **Configurações → Sobre o telefone → Versão do Android** antes de começar. Os comandos deste guia são executados no **Termux do aparelho antigo**, salvo indicação em contrário. Cole e execute os blocos em ordem; espere cada instalação terminar.

Instale [Termux](https://f-droid.org/en/packages/com.termux/) e [Termux:Boot](https://f-droid.org/en/packages/com.termux.boot/) pelo **mesmo canal**. Abra ambos uma vez. Não misture APKs do F-Droid com plugins de outra origem.

No Termux:

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git ffmpeg termux-services nano
node -v
ffmpeg -version
git clone https://github.com/ThHSzR/bom-dia.git "$HOME/bom-dia"
cd "$HOME/bom-dia"
npm ci
cp config.example.json config.json
nano config.json
```

Mantenha o projeto no diretório privado do Termux (`$HOME/bom-dia`), não em `/sdcard`. Após instalar `termux-services`, feche e abra a sessão do terminal para carregar o supervisor, ou execute:

```bash
. "$PREFIX/etc/profile.d/start-services.sh"
```

## 2. Configurar número, horário e legenda

Exemplo (os números abaixo são fictícios):

```json
{
  "enabled": false,
  "ownerNumber": "5511999999999",
  "recipientNumber": "5511988888888",
  "time": "07:15",
  "timeZone": "America/Sao_Paulo",
  "catchUpMinutes": 120,
  "captionMode": "random",
  "caption": "BOM DIA 🌹☕ Que Deus abençoe seu dia! 🙏✨",
  "maxVideoSeconds": 12
}
```

| Campo | Significado |
| --- | --- |
| `enabled` | `false` permite configurar sem enviar; altere para `true` para ativar a agenda. |
| `ownerNumber` | Número da **sua conta remetente**, usado ao pedir código de vinculação. |
| `recipientNumber` | Número do único contato que receberá o GIF. Não aceita grupos. |
| `time` | Horário local em 24 horas, `HH:MM`. |
| `timeZone` | Fuso IANA, independente do fuso configurado no Android. |
| `catchUpMinutes` | Atraso máximo tolerado no mesmo dia, de 0 a 720 minutos. Com 120, tenta até 09:15:59 para uma agenda às 07:15. |
| `captionMode` | `random` sorteia frases; é o padrão também quando o campo não existe. `fixed` usa a legenda antiga. |
| `caption` | Legenda usada no modo `fixed`, de 1 a 1000 caracteres. Mantenha o campo mesmo usando `random`. |
| `maxVideoSeconds` | Aproveita até os primeiros N segundos do GIF, de 1 a 30; padrão 12. |

Números devem ser strings com **DDI + DDD + número**, sem `+`, espaços, parênteses ou `@`. Para o Brasil, começam com `55`. Informe o número cadastrado no WhatsApp; o bot consulta o serviço para resolver o endereço do destinatário.

A configuração é lida na inicialização. Após editar, reinicie o processo. Alterar destinatário ou horário não libera um segundo envio no mesmo dia.

No editor `nano`, mantenha as aspas e vírgulas do JSON. Para salvar, toque em **CTRL** na barra do Termux e depois em **O**, confirme com **Enter** e saia com **CTRL + X**. Durante a preparação inicial, deixe `enabled` como `false`.

## 3. Colocar os GIFs e verificar

### Frases aleatórias e quebras de linha

A coleção `captions.json` já vem com **40 frases**, com saudações como “BOM DIA”, “bodia”, “bomdia”, “bom dia, flor do dia” e um “Bundinha” como easter egg. Todas têm uma saudação na primeira linha e uma mensagem na segunda. Exemplo no WhatsApp:

```text
BOM DIA 🌹☕
Que Deus abençoe seu dia e não deixe faltar café! 🙏✨
```

As frases têm seu próprio ciclo sem repetição, independente dos GIFs. Com 100 GIFs e 40 frases, as frases recomeçam após 40 tentativas reservadas, enquanto os GIFs continuam seu ciclo. Na virada, evita repetir imediatamente a última frase se houver mais de uma disponível. O easter egg aparece uma vez por ciclo completo da coleção padrão, em posição aleatória.

O texto escolhido fica registrado junto ao envio em `data/state.json`. GIF e frase são reservados juntos antes do envio; uma falha ambígua consome ambos. Reinícios preservam os ciclos. A atualização lê o histórico antigo sem apagá-lo e não libera um segundo envio no mesmo dia.

**Para quem já usa o bot:** basta atualizar e reiniciar. A ausência de `captionMode` ativa o sorteio automaticamente. A antiga `caption` continua no arquivo e pode ser usada definindo `"captionMode": "fixed"`.

Para personalizar, crie uma cópia local, que não é enviada ao Git:

```bash
cd "$HOME/bom-dia"
cp captions.json captions.local.json
nano captions.local.json
```

Faça a cópia apenas ao criar o arquivo pela primeira vez, para não sobrescrever suas edições. Exemplo de conteúdo válido:

```json
[
  "BOM DIA 🌹☕\nQue Deus abençoe seu dia! 🙏✨",
  "Bodia 😴\nA alma só chega depois do café.",
  "Bom dia, flor do dia 🌻\nQue hoje não falte motivo para sorrir!",
  "Bundinha\nQue seu dia seja leve e a cadeira seja macia."
]
```

**No JSON, escreva `\n`: o WhatsApp recebe uma quebra de linha real.** Não coloque uma quebra literal dentro das aspas no arquivo JSON. Cada frase deve começar com `Bom dia`, `Bomdia`, `Bodia` ou `Bundinha` (maiúsculas/minúsculas e prolongamentos como `Bomdiaaa` são aceitos), ter mensagem após a quebra e no máximo 1000 caracteres. Frases duplicadas contam uma vez; um arquivo vazio ou inválido gera erro.

`captions.local.json`, quando existe, substitui toda a coleção padrão. Evite editar `captions.json` diretamente para não ter conflitos ao atualizar. Reinicie o serviço após editar frases. Novas frases entram no ciclo, e as removidas deixam de ser sorteadas. `npm run check`, com o serviço parado, mostra uma prévia sem consumir o ciclo. Inclua `captions.local.json` no backup se o tiver criado.

### Importar GIFs

Coloque arquivos `.gif` na pasta `gifs/`. Para importar da pasta Downloads do Android:

```bash
termux-setup-storage
# Autorize o acesso solicitado pelo Android.
cp "$HOME"/storage/downloads/*.gif "$HOME/bom-dia/gifs/"
cd "$HOME/bom-dia"
npm test
npm run check
```

`check` valida configuração e histórico, escolhe um arquivo e testa a conversão local. **Não conecta ao WhatsApp, não envia mensagens e não consome o ciclo.** Pare o serviço antes de executá-lo, pois ele usa a mesma área temporária da aplicação.

Use GIFs de até 25 MB. A saída tem largura máxima de 480 pixels, 15 quadros/s, sem áudio e limite local de 15 MB. GIFs longos são truncados conforme `maxVideoSeconds`. O repositório inclui 179 GIFs fornecidos pelo usuário (aproximadamente 162 MB), com conteúdos distintos por SHA-256. Eles chegam na pasta gifs/ ao clonar ou atualizar o projeto. A pasta é relida a cada preparação, então é possível adicionar ou remover GIFs sem reiniciar.

### Usar um pack local

O bot usa os arquivos locais: **não pesquisa nem baixa GIFs da internet automaticamente e não precisa de chave de API de um catálogo de GIFs**. Ainda precisa de internet para se conectar ao WhatsApp e enviar.

Se seu pack vier em ZIP, extraia-o pelo gerenciador de arquivos do Android e copie os `.gif` extraídos para `gifs/`. O bot lê apenas arquivos diretamente nessa pasta, não subpastas. Renomear uma imagem JPG, WebP ou um vídeo para `.gif` não converte o formato.

O comando de importação acima copia arquivos terminados em `.gif` diretamente de Downloads. Se os seus estiverem numa subpasta ou tiverem extensão `.GIF`, adapte o caminho. Para conferir o conteúdo importado:

```bash
ls "$HOME/bom-dia/gifs"
```

Depois da importação, as cópias em Downloads não são necessárias para o bot. Adicionar GIFs não exige novo pareamento nem apagar o histórico. Evite copiar arquivos novos enquanto o bot estiver preparando um envio; se necessário, pare o serviço, copie e inicie novamente.

## 4. Vincular sua conta

### Código de pareamento (mais prático no mesmo celular)

```bash
cd "$HOME/bom-dia"
npm run pair
```

No WhatsApp da conta remetente, abra **Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone** e informe o código mostrado pelo terminal. Os nomes podem variar entre versões do aplicativo. `ownerNumber` deve ser o número dessa conta, não o destinatário.

Espere a mensagem `Sessao salva. Vinculacao concluida`. O comando termina sozinho, sem enviar nada. Se o código expirar, interrompa com Ctrl+C e execute novamente. O celular que roda o bot pode ser diferente do que contém a conta principal do WhatsApp.

### QR Code

```bash
npm run qr
```

Escaneie o QR pelo menu **Aparelhos conectados** do WhatsApp. É necessário conseguir mostrar o terminal em outra tela para escanear com a câmera; no mesmo aparelho, prefira o código. QR e código são exibidos apenas durante a vinculação; não compartilhe nem publique essa saída.

**Com dois celulares, o QR costuma ser mais prático:** execute `npm run qr` no Android antigo e escaneie essa tela usando o WhatsApp do celular principal. Depois de aparecer a confirmação de sessão salva, use `npm start`; não é necessário executar `pair` ou `qr` toda vez.

O bot mantém a sessão em `data/auth/session.json`. Reinícios normais não exigem vincular novamente. Não execute os comandos de vinculação com o serviço ativo.

## 5. Ativar e manter rodando

Edite `config.json` e coloque `"enabled": true`. Para testar em primeiro plano:

```bash
npm start
```

**Se já estiver dentro da janela do dia e ainda não houver registro, ele enviará assim que conectar.** Para um primeiro teste controlado, configure um horário alguns minutos à frente. O primeiro envio conta normalmente para o histórico do dia; não existe comando que ignore a proteção diária.

Depois de conferir, encerre com Ctrl+C e instale o serviço:

```bash
cd "$HOME/bom-dia"
# Se usou um horario temporario no teste, ajuste agora para o horario definitivo.
nano config.json
bash scripts/install-service.sh
. "$PREFIX/etc/profile.d/start-services.sh"
sv-enable bom-dia
sv status bom-dia
```

Execute essas linhas uma por vez. **O ponto e o espaço no início de `. "$PREFIX/etc/profile.d/start-services.sh"` são necessários:** carregam o caminho dos serviços no terminal atual. Executar o instalador com `bash` carrega esse ambiente apenas dentro do instalador, não no terminal que o chamou.

Se o status começar com `run: bom-dia:`, o processo está rodando. Isso confirma o processo ativo, não a entrega de uma mensagem; confira também o histórico e os logs. Não execute `npm start` ao mesmo tempo que o serviço.

O instalador configura o supervisor, logs do serviço e um script em `~/.termux/boot/20-bom-dia-services`. Ele deixa o serviço desativado até `sv-enable`. Não sobrescreve um serviço `bom-dia` já existente.

### Para que serve o Termux:Boot?

| Componente | Papel |
| --- | --- |
| Termux | É o ambiente no qual o bot executa. |
| Serviço runit (`termux-services`) | Mantém o processo supervisionado enquanto o ambiente está ativo e pode reiniciá-lo se cair. |
| Termux:Boot | Executa o script de inicialização depois que o celular reinicia, iniciando os serviços habilitados. |

Você não precisa digitar comandos nem cadastrar o bot dentro do aplicativo Termux:Boot. **Instale e abra o aplicativo uma vez**; é normal que ele mostre apenas instruções. Nosso instalador já cria o arquivo que ele executará na inicialização.

**Apagar a tela não é reiniciar o celular.** Com o serviço ativo, o bot pode continuar trabalhando com a tela apagada; o Boot é usado quando o aparelho é desligado e ligado novamente. Apenas instalar o Termux:Boot não inicia o bot sem o script e o serviço habilitado.

Na configuração do Android:

1. Remova a otimização/restrição de bateria de **Termux e Termux:Boot**.
2. Permita atividade em segundo plano e inicialização automática, se o fabricante oferecer essas opções.
3. Abra o Termux:Boot uma vez após instalar. Faça um teste real reiniciando o aparelho e desbloqueando-o.
4. Mantenha rede e alimentação disponíveis; evite usar um aparelho com bateria estufada ou aquecimento anormal.

O wake lock ajuda a manter a CPU ativa; o supervisor reinicia o Node se ele cair. **Nenhum deles garante sobrevivência se o Android matar todo o Termux, se alguém usar “Forçar parada”, ou se faltar rede/energia.** Nesses casos, reabra o Termux; a recuperação depende da janela configurada. Alguns aparelhos só liberam o início após o primeiro desbloqueio do sistema.

Para conferir o início automático, reinicie o aparelho e desbloqueie-o. Aguarde alguns instantes e consulte `sv status bom-dia`. Confira também o horário de início nos logs: abrir o Termux pode iniciar o supervisor, então ver `run:` somente após abri-lo não comprova, por si só, que o Termux:Boot funcionou. Teste também uma execução agendada com a tela apagada no seu aparelho.

```bash
sv status bom-dia           # estado do processo
sv down bom-dia             # parar agora
sv up bom-dia               # iniciar agora
sv restart bom-dia          # recarregar config.json
sv-disable bom-dia          # parar e desativar inicio automatico
sv-enable bom-dia           # reativar inicio automatico
tail -f "$PREFIX/var/log/sv/bom-dia/current"
```

O supervisor para o serviço após erros de configuração ou erros que exigem intervenção, como logout. Isso evita reinícios infinitos com credenciais inválidas. Falhas comuns de rede geram reconexão com espera crescente, até aproximadamente 5 minutos.

## Histórico, repetição e falhas

```bash
cd "$HOME/bom-dia"
npm run history
tail -n 30 logs/bot.jsonl
```

`data/state.json` guarda todo o histórico e os hashes já usados no ciclo. `npm run history` mostra os últimos 30 registros. O log da aplicação gira em aproximadamente 5 MB, com 3 cópias anteriores; o log do supervisor usa arquivos de aproximadamente 1 MB e até 5 anteriores.

O bot verifica o relógio a cada 15 segundos. Quando volta a conectar, recupera **apenas o envio do dia atual**, dentro da janela definida; não manda vários GIFs acumulados. Se perder completamente a janela, aquele dia fica sem envio. Horários inexistentes/repetidos por mudança de horário de verão seguem o relógio local e a mesma janela; o histórico impede segunda tentativa na hora repetida.

Cada GIF usado é removido do sorteio até terminar o ciclo. Quando todos os arquivos disponíveis foram usados, começa outro ciclo. Se houver mais de um arquivo, evita repetir o último na virada do ciclo. Com um único GIF, ele naturalmente reaparece no próximo dia. Arquivos adicionados entram no ciclo; arquivos removidos deixam de ser candidatos.

### O limite de confiabilidade: uma tentativa por dia

Não existe transação única que cubra disco local e servidores do WhatsApp. Se houver queda após transmitir e antes de salvar a resposta, não é possível garantir simultaneamente entrega e ausência de duplicata.

Este projeto prioriza **não enviar duas vezes**: grava uma reserva durável do dia e do GIF antes de chamar `sendMessage`.

| Status | Interpretação |
| --- | --- |
| `attempting` | Reserva persistida; a operação pode ter sido interrompida. |
| `submitted` | `sendMessage` retornou uma mensagem; **não confirma recebimento ou leitura** pelo contato. |
| `uncertain` | Houve falha após a reserva ou reinício com operação incompleta. Não há reenvio automático nesse dia. |

Uma falha ambígua também consome o GIF no ciclo. Uma falha antes da reserva, como GIF inválido ou número não encontrado, permite nova preparação após 5 minutos, enquanto a janela continuar aberta. **Não apague o histórico para forçar uma tentativa**: você pode duplicar uma mensagem já entregue. Consulte a conversa pelo WhatsApp para esclarecer o resultado.

## Recuperação e manutenção

### `unable to change to service directory: file does not exist`

Se o instalador informou que concluiu ou que **o serviço já existe**, mas `sv-enable bom-dia` ou `sv status bom-dia` mostra esse erro, primeiro carregue o ambiente no terminal atual:

```bash
. "$PREFIX/etc/profile.d/start-services.sh"
sv-enable bom-dia
sv status bom-dia
```

Não reinstale repetidamente. A mensagem `O servico bom-dia ja existe` significa que o instalador preservou a instalação anterior. Se o erro persistir, confira a existência do arquivo e consulte o serviço pelo caminho completo:

```bash
ls "$PREFIX/var/service/bom-dia/run"
sv status "$PREFIX/var/service/bom-dia"
```

Se o arquivo `run` realmente não existir, a instalação não está completa; confira a saída do instalador. Se o erro mencionar `supervise/ok`, o supervisor pode ainda estar iniciando: aguarde alguns segundos após carregar `start-services.sh` e tente novamente.

### Outros casos

- **`npm run pair` conecta, mas `npm start` pede para vincular de novo**: atualize com `git pull --ff-only` e execute `npm start`. A primeira versão verificava apenas `registered`, que pode continuar falso após o pareamento. A correção reconhece a identidade assinada já salva, sem apagar a sessão ou exigir novo QR.
- **`data/PAUSED`**: pare o serviço e leia o arquivo e os logs. Corrija a causa antes de retomar. Para uma falha de disco ou configuração já corrigida, preserve o histórico, remova apenas `data/PAUSED` e execute `sv-enable bom-dia`.
- **Logout, sessão inválida ou aparelho desvinculado**: pare o serviço, mova `data/auth` para um backup privado e execute `npm run pair`. Uma vinculação concluída remove a pausa. Depois execute `sv-enable bom-dia`. Não mova nem apague `data/state.json`.
- **Outra instância ativa**: pare o serviço antes de usar `pair`, `qr` ou `check`. A porta local 39471 serve somente como trava, não como API ou painel.
- **Erro na conversão**: confira `ffmpeg -encoders` e a presença de `libx264`. Rode `npm run check` com o serviço parado; retire um GIF inválido da pasta se necessário.
- **Configuração não mudou**: use `sv restart bom-dia`.
- **Sessão ou histórico corrompidos**: o programa falha explicitamente. Restaure backup; não recria silenciosamente o histórico.

Backup com o serviço parado:

```bash
sv down bom-dia
cd "$HOME/bom-dia"
tar -czf "$HOME/bom-dia-backup-$(date +%Y%m%d-%H%M%S).tar.gz" config.json data gifs
sv up bom-dia
```

O backup contém credenciais de acesso ao WhatsApp. Mantenha-o privado. `config.json`, `captions.local.json`, `data/`, `logs/` e `node_modules/` estão excluídos do Git. Os arquivos .gif diretamente em gifs/ são versionados e ficam públicos quando enviados a este repositório. O histórico contém o número destinatário; a aplicação não arquiva conversas recebidas. `data/messages.json` mantém as últimas mensagens geradas por até 30 dias para recuperação de conteúdo solicitada pelo protocolo.

Para atualizar o código, faça backup e então:

```bash
sv down bom-dia
cd "$HOME/bom-dia"
git pull --ff-only
npm ci
npm test
npm run check
sv up bom-dia
```

Revise atualizações do Baileys antes de trocar a versão. Quando necessário, altere a versão exata, gere novamente o lockfile e repita os testes.

## Estrutura

```text
bom-dia/
├── package.json / package-lock.json
├── config.example.json
├── captions.json                # colecao padrao de frases
├── captions.local.json          # personalizacao opcional, privada
├── config.json                  # privado, criado por voce
├── .npmrc
├── gifs/                        # seus GIFs
├── src/
│   ├── index.js                 # conexao, pareamento e agenda
│   ├── core.js                  # persistencia, ciclo e reserva diaria
│   ├── auth.js                  # adaptador de sessao/chaves
│   ├── media.js                 # conversao e miniatura
│   ├── runtime.js               # trava e logs
│   ├── check.js                 # verificacao sem envio
│   └── history.js
├── scripts/install-service.sh
├── test/                        # testes offline
├── .github/workflows/test.yml
├── data/                        # criado durante uso, privado
└── logs/                        # criado durante uso, privado
```

## Validação realizada

20 testes offline passaram com Node 24 no Windows: configuração, relógio/fuso/janela, mudança de horário de verão, ciclos, alterações na pasta, duplicatas por conteúdo, falhas de persistência/rede, reinício, sessão/chaves reais do Baileys, coleção de frases, ciclos independentes, compatibilidade com histórico antigo, quebras de linha e conversão de GIF real com montagem de mensagem Baileys usando upload simulado. Instalação das dependências concluída; a auditoria npm não apontou vulnerabilidades naquele momento. O teste de mídia é marcado como ignorado se não houver FFmpeg; para validação completa ele precisa executar e passar.

Os testes automatizados não fazem login nem enviam mensagens reais. Na instalação manual em um Android antigo, o usuário confirmou o funcionamento após a correção do reconhecimento da sessão e confirmou a solução do erro de localização do serviço ao carregar `start-services.sh` no terminal. Isso não substitui a verificação de reinício automático e execução com tela apagada em cada aparelho. Há um workflow de testes Linux no repositório para cada push e pull request.

## Fontes consultadas

- [Versões publicadas do Baileys no npm](https://www.npmjs.com/package/@whiskeysockets/baileys?activeTab=versions).
- [Código e manifesto da release v7.0.0-rc14](https://github.com/WhiskeySockets/Baileys/tree/v7.0.0-rc14).
- [Exemplo oficial de conexão e vinculação](https://github.com/WhiskeySockets/Baileys/blob/master/Example/example.ts).
- [Implementação de preparação de mídia](https://github.com/WhiskeySockets/Baileys/blob/v7.0.0-rc14/src/Utils/messages.ts).
- [Instalação e limitações do Termux](https://github.com/termux/termux-app#installation).
- [Termux:Boot](https://github.com/termux/termux-boot#how-to-use) e [termux-services](https://github.com/termux/termux-services).
