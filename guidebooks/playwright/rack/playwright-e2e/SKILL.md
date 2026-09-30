---
name: playwright-e2e
description: Como o belayer escreve testes e2e selados com Playwright
roles: [belayer]
load: always
---

- Um arquivo por cenário da line, nomeado pelo comportamento (`exporta-com-zoom.spec.ts`).
- Localize elementos por `getByTestId` com os ids dos bolts, ou por papel acessível (`getByRole`). Nunca por classe CSS.
- Nada de `waitForTimeout`; espere por estado visível com `expect(...).toBeVisible()` e afins.
- Cada teste prepara os próprios dados e não depende da ordem de execução.
- Marque com `@rapido` os testes que rodam em menos de 5 segundos, para a suíte curta.
- Asserções sobre o que a pessoa vê ou recebe, não sobre detalhes de implementação.
