---
name: react-component
description: Como escrever e alterar componentes React com estados completos e testáveis
roles: [climber]
when:
  files: ["**/*.tsx", "**/*.jsx"]
---

- Um componente por arquivo, nomeado igual ao componente. Props tipadas com `interface`, sem `any`.
- Estado local com `useState`; estado compartilhado segue o padrão que o projeto já usa (veja o beta). Não crie um Context novo sem necessidade.
- Dados remotos passam pela camada de dados do projeto, nunca por `fetch` direto no componente.
- Todo componente que carrega dados tem estados de carregando, vazio e erro.
- Elementos com que o usuário interage recebem o `data-testid` definido nos bolts.
- Controle interativo é `button`, `a` ou `input` de verdade, com rótulo acessível.
- Efeitos com `useEffect` só para sincronizar com algo externo; derive o resto no render.
