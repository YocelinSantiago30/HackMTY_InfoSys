export const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const fixed = (value, digits = 1) => num(value).toLocaleString('es-MX', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const money = (value) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num(value));
export const errorMessage = (e) => e?.response?.data?.message || e?.response?.data?.error || e?.message || 'No se pudo completar la operación.';
export const agentTitle = (code) => code === 'BASELINE' ? 'Baseline' : 'SmartCourier AI';
export const statusLabel = (status) => ({ CREATED:'Creada', RUNNING:'En curso', PAUSED:'En pausa', FINISHED:'Finalizada', CANCELLED:'Cancelada', IDLE:'Disponible', TO_PICKUP:'Hacia recolección', WAITING_PICKUP:'Esperando preparación', TO_DROPOFF:'En entrega', REPOSITIONING:'Reposicionándose' }[status] || status || 'Disponible');
