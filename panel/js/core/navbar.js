import { router } from './router.js';

let _navScrollHandler = null;
let _navScrollTimer   = null;

const items = [
  { key: 'dashboard',  route: '/panel/dashboard',  icon: 'fa-solid fa-house',        label: 'Início'     },
  { key: 'simulacao',  route: '/panel/simulacao',  icon: 'fa-solid fa-file-pen',     label: 'Simulação'  },
  { key: 'progresso',  route: '/panel/progresso',  icon: 'fa-solid fa-chart-line',   label: 'Progresso'  },
  { key: 'mentor',     route: '/panel/mentor',     icon: 'fa-solid fa-brain',        label: 'Mentor'     },
  { key: 'perfil',     route: '/panel/perfil',     icon: 'fa-solid fa-circle-user',  label: 'Perfil'     },
];

export function renderNavbar(activeItem = '') {
  const mount = document.getElementById('navbar-mount');
  if (!mount) return;

  mount.innerHTML = `
    <nav class="navbar" role="navigation" aria-label="Navegação principal">
      ${items.map(item => `
        <button
          class="navbar-item notranslate ${activeItem === item.key ? 'active' : ''}"
          translate="no"
          data-route="${item.route}"
          aria-label="${item.label}"
          ${activeItem === item.key ? 'aria-current="page"' : ''}
        >
          <i class="${item.icon}" aria-hidden="true"></i>
          <span>${item.label}</span>
        </button>
      `).join('')}
    </nav>
  `;

  mount.querySelectorAll('.navbar-item').forEach(btn => {
    btn.addEventListener('click', () => {
      router.navigate(btn.dataset.route);
    });
  });

  if (_navScrollHandler) window.removeEventListener('scroll', _navScrollHandler);
  clearTimeout(_navScrollTimer);

  const _navbar = mount.querySelector('.navbar');
  _navScrollHandler = () => {
    if (_navbar) _navbar.style.transform = 'translateY(100%)';
    clearTimeout(_navScrollTimer);
    _navScrollTimer = setTimeout(() => {
      if (_navbar) _navbar.style.transform = 'translateY(0)';
    }, 600);
  };
  window.addEventListener('scroll', _navScrollHandler, { passive: true });
}
