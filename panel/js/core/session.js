// ============================================================
// panel/js/core/session.js
// ExameNova — In-memory session store
// Shared across screens that pass data without URL params.
// Clears automatically on page reload — never persists.
//
// USAGE:
//   import { session } from '../../core/session.js';
//   session.simulacao = { questions, mode, subject, ... };
//   router.navigate('/panel/renders/simulacao-render');
//
// SCREENS THAT USE THIS:
//   simulacao.js        → writes session.simulacao
//   simulacao-render.js → reads  session.simulacao
//   desafio.js          → writes session.desafio      (Phase 4)
//   desafio-render.js   → reads  session.desafio      (Phase 4)
//   meu-exame.js        → writes session.meuExame     (Phase 5)
//   meu-exame-render.js → reads  session.meuExame     (Phase 5)
// ============================================================

export const session = {
  simulacao:  null,
  desafio:    null,
  meuExame:   null,
};
