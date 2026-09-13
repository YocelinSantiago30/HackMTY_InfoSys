const TOKEN_KEY = 'smartcourier.web.token';
export async function getToken() { return localStorage.getItem(TOKEN_KEY); }
export async function saveToken(token) { localStorage.setItem(TOKEN_KEY, token); }
export async function removeToken() { localStorage.removeItem(TOKEN_KEY); }
