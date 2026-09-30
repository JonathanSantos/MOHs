---
name: ui
description: Interface, acessibilidade e estados de tela nos componentes alterados
when:
  files: ["**/*.{tsx,jsx,css,scss,html,vue,svelte}"]
---

Nos componentes do diff:

- Estados de carregando, vazio e erro existem e dizem o que fazer.
- Todo controle tem rótulo acessível e funciona pelo teclado.
- Contraste legível e foco visível.
- Textos claros, do ponto de vista de quem usa.
- Nada trava a tela sem indicação de progresso.

Evidência de UI vem de navegador real quando o Lookout tiver capturas; sem captura, reduza a confiança.

Severidade: high quando impede a tarefa; medium quando atrapalha; low para acabamento.
