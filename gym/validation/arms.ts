/** What an arm's subagent gets: the request, where it works and, in MOHs arms, the frozen `mohs` of this run. */
export interface ArmContext {
  request: string;
  /** The arm's folder: the only place its subagent works. */
  dir: string;
  /** This run's frozen MOHs, with the arm's own MOHS_HOME. */
  mohs: string;
  /** The agent skill of the frozen MOHs. */
  skill: string;
}

export interface Arm {
  id: string;
  label: string;
  /** What comparing this arm with the others tells us. */
  measures: string;
  usesMohs: boolean;
  prompt(context: ArmContext): string;
}

const REPORT =
  "No fim, relate em até 12 linhas: o que você fez, as decisões que tomou sem perguntar a ninguém e o que ficou de fora. Não faça commit.";

const HUMAN =
  "Eu faço o papel do humano. Quando o MOHs disser que é a vez do humano (assinar, responder um rescue), pare e me relate exatamente o que ele pediu; eu respondo e você continua.";

/** The usage of nested subagents never reaches whoever started the orchestrator: it has to come in the report. */
const CHILDREN =
  "No relato, liste também cada subagente que você criou, com os tokens, as chamadas de ferramenta e o tempo que a notificação dele trouxe, numa linha por subagente: nome · tokens · ferramentas · ms.";

/**
 * The placebo gets about as much text as the MOHs skill gives an agent, all of it process and none of it mechanism:
 * the difference between the placebo and MOHs is what the harness does, not how much the agent was told.
 */
const PLACEBO_PROCESS = [
  "Siga este processo, na ordem, e não pule etapas.",
  "1. Entenda antes de mexer. Leia o README, os testes e o código que o pedido toca. Anote em uma frase o problema que o pedido resolve e para quem.",
  "2. Planeje por escrito, antes de qualquer código. Liste os arquivos que vai criar ou alterar e os passos pequenos em que o trabalho se divide. Cada passo deve caber numa sessão curta e terminar com o projeto funcionando.",
  "3. Decida o que o pedido não diz. Liste cada ponto ambíguo (valores padrão, entradas inválidas, limites, mensagens de erro, o que acontece quando algo não existe) e escolha uma resposta para cada, com o motivo em uma linha. Prefira o comportamento que surpreende menos quem usa.",
  "4. Escreva os testes antes do código. Para cada comportamento do pedido, um teste do caso principal; depois os limites (vazio, máximo, repetição) e os erros (entrada inválida, recurso inexistente). Rode os testes e confira que falham pelo motivo certo, e não por um erro de importação.",
  "5. Implemente o mínimo que faz os testes passarem, um passo do plano por vez. Depois de cada passo, rode a suíte inteira do projeto. Se algo quebrar, corrija antes de seguir.",
  "6. Revise o seu diff como um revisor exigente faria: duplicação do que o projeto já tem, nomes que não dizem o que a coisa é, funções longas demais, entradas não validadas, dados sensíveis em log ou em mensagem de erro, dependências novas sem necessidade. Corrija o que encontrar e rode a suíte de novo.",
  "7. Confira o escopo. Toque só no que o pedido precisa; o que você notou fora dele e não mudou vai para o relato, não para o código.",
  "8. Confirme o fim: a suíte inteira passa, cada comportamento do pedido tem teste, e cada decisão do passo 3 está no código e no relato.",
  "",
  "Você faz sozinho quatro papéis, um de cada vez, e troca de chapéu de propósito:",
  "- Planejador: olha o pedido inteiro, divide em passos pequenos e escreve o que fica de fora. Não escreve código.",
  "- Autor dos testes: escreve os testes a partir do pedido e das decisões, como se não fosse implementar depois. Testa comportamento observável (o que sai, o que muda, o erro que aparece), não detalhes internos.",
  "- Implementador: faz os testes passarem com o código mais simples que resolve, seguindo os padrões que o projeto já usa.",
  "- Revisor: lê o diff como se fosse de outra pessoa, com as listas abaixo, e só aprova quando não sobra nada importante.",
  "",
  "Lista de segurança do revisor:",
  "- Toda entrada vinda de fora é validada antes de chegar em consulta, comando, caminho de arquivo ou HTML.",
  "- Nenhum segredo, token ou dado pessoal em código, log ou resposta de erro.",
  "- Rotas e ações novas têm a autorização que as vizinhas têm.",
  "- Identificadores públicos e tokens vêm de fonte criptográfica.",
  "- Nenhuma dependência nova sem necessidade clara.",
  "",
  "Lista de arquitetura do revisor:",
  "- Código novo no lugar certo da estrutura existente, sem duplicar o que o projeto já tem.",
  "- Dependências entre módulos na direção certa.",
  "- Interfaces públicas pequenas e com nomes que dizem o que fazem.",
  "- Nenhuma abstração nova sem uso real agora.",
  "- Testes seguindo os padrões do projeto, sem repetir preparação que poderia ser um helper.",
  "",
  "Quando o pedido é ambíguo, não pare para perguntar: decida, siga e registre a decisão no relato. Quando um teste seu parecer errado, releia o pedido antes de mudar o teste; mude o teste só se o pedido sustentar a mudança, e diga isso no relato. Quando algo no ambiente estiver quebrado (dependência faltando, comando que não roda), diga no relato o que tentou.",
].join("\n");

/**
 * The arms a validation can compare. Every arm gets the same request and its own copy of the project; only the way
 * of working changes, so the difference in results is the harness (or the text) and not the task.
 */
export const ARMS: Record<string, Arm> = {
  direto: {
    id: "direto",
    label: "Agente direto",
    measures: "a linha de base: o agente sozinho, sem harness nem instrução extra",
    usesMohs: false,
    prompt: ({ request, dir }) =>
      [
        `Pedido: ${request}`,
        `Trabalhe só na pasta ${dir}; não leia nem altere nada fora dela.`,
        "Faça a mudança pedida. Se o projeto tem testes, acrescente os que a mudança pede.",
        REPORT,
      ].join("\n\n"),
  },
  placebo: {
    id: "placebo",
    label: "Placebo",
    measures: "quanto do ganho vem só de mais instrução em texto, sem nenhum mecanismo",
    usesMohs: false,
    prompt: ({ request, dir }) =>
      [`Pedido: ${request}`, `Trabalhe só na pasta ${dir}; não leia nem altere nada fora dela.`, PLACEBO_PROCESS, REPORT].join("\n\n"),
  },
  "mohs-fix": {
    id: "mohs-fix",
    label: "MOHs talc (mohs fix)",
    measures: "o custo da trilha mais leve do harness: uma tarefa de climber, checagens e assinatura no fim",
    usesMohs: true,
    prompt: ({ request, dir, mohs, skill }) =>
      [
        `Leia a skill em ${skill}. Neste teste, o comando do MOHs é ${mohs} (use-o sempre no lugar de "mohs").`,
        `Na pasta ${dir}, rode: ${mohs} fix ${JSON.stringify(request)} --detach`,
        "Faça a tarefa que a saída mostrar e siga o que o MOHs pedir até o fim.",
        HUMAN,
        REPORT,
      ].join("\n\n"),
  },
  mohs: {
    id: "mohs",
    label: "MOHs completo",
    measures: "o harness como foi desenhado: plano, line, a trilha que o scout escolher e um subagente por papel",
    usesMohs: true,
    prompt: ({ request, dir, mohs, skill }) =>
      [
        `Leia a skill em ${skill}. Neste teste, o comando do MOHs é ${mohs} (use-o sempre no lugar de "mohs").`,
        `Na pasta ${dir}, rode: ${mohs} climb ${JSON.stringify(request)} --detach`,
        "Conduza o climb como a skill manda, criando um subagente por papel e esperando cada um terminar.",
        HUMAN,
        REPORT,
        CHILDREN,
      ].join("\n\n"),
  },
  "mohs-solo": {
    id: "mohs-solo",
    label: "MOHs sem subagentes",
    measures: "o custo da orquestração: o mesmo climb, com um agente fazendo todos os papéis (o sigilo do seal se perde)",
    usesMohs: true,
    prompt: ({ request, dir, mohs, skill }) =>
      [
        `Leia a skill em ${skill}. Neste teste, o comando do MOHs é ${mohs} (use-o sempre no lugar de "mohs").`,
        `Na pasta ${dir}, rode: ${mohs} climb ${JSON.stringify(request)} --detach`,
        "Faça você mesmo todas as tarefas, sem criar subagentes (use --task quando houver mais de uma aberta).",
        HUMAN,
        REPORT,
      ].join("\n\n"),
  },
};

/** For a small request (a button, a fix); a large one usually drops mohs-fix and may add mohs-solo. */
export const DEFAULT_ARMS = ["direto", "placebo", "mohs-fix", "mohs"];
