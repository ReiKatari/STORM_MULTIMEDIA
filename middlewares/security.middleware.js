/**
 * STORM MULTIMEDIA 1.2.0 — Криптографическая защита, Helmet CSP, XSS-фильтр и валидатор схем (Пункты 3.1, 3.3, 3.5)
 */

export function helmetSecurityHeadersMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' https: http: data: blob: ws: wss:; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http: blob:; " +
    "style-src 'self' 'unsafe-inline' https: http:; " +
    "img-src 'self' https: http: data: blob:; " +
    "media-src 'self' https: http: data: blob:; " +
    "frame-src 'self' https: http:; " +
    "connect-src 'self' https: http: ws: wss:;"
  );
  next();
}

export function isRequestSecure(req) {
  if (!req) return false;
  if (req.secure) return true;
  const proto = String(req.headers?.['x-forwarded-proto'] || '').toLowerCase();
  return proto === 'https';
}

export function parseVaultTokensFromReq(req) {
  if (!req) return [];
  const out = [];
  const addTok = (t) => {
    const clean = String(t || '').trim();
    if (/^[a-zA-Z0-9_-]{16,256}$/.test(clean) && !out.includes(clean)) {
      out.push(clean);
    }
  };
  if (req.token) addTok(req.token);
  const headerVault = req.headers?.['x-storm-vault'];
  if (headerVault) {
    String(headerVault).split(/[.,;\s]+/).forEach(addTok);
  }
  const cookieHeader = String(req.headers?.cookie || '');
  const vaultMatch = cookieHeader.match(/storm_vault=([a-zA-Z0-9_.-]+)/);
  if (vaultMatch && vaultMatch[1]) {
    vaultMatch[1].split('.').forEach(addTok);
  }
  const tokMatch = cookieHeader.match(/storm_token=([a-zA-Z0-9_-]+)/);
  if (tokMatch && tokMatch[1]) {
    addTok(tokMatch[1]);
  }
  return out.slice(0, 8);
}

export function setVaultCookieOnly(res, vaultTokens = [], req = null) {
  if (!res) return;
  const maxAge = 30 * 24 * 3600;
  const secureFlag = isRequestSecure(req) ? '; Secure' : '';
  const cleanList = Array.from(new Set((vaultTokens || []).map(t => String(t || '').trim()).filter(t => /^[a-zA-Z0-9_-]{16,256}$/.test(t)))).slice(0, 8);
  if (cleanList.length === 0) {
    res.setHeader('Set-Cookie', 'storm_vault=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  } else {
    res.setHeader('Set-Cookie', `storm_vault=${cleanList.join('.')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`);
  }
}

export function setSecureSessionCookie(res, token, req = null, extraVaultTokens = []) {
  if (!token || !res) return;
  const maxAge = 30 * 24 * 3600;
  const secureFlag = isRequestSecure(req) ? '; Secure' : '';
  const combinedVault = Array.from(new Set([
    String(token).trim(),
    ...parseVaultTokensFromReq(req),
    ...(Array.isArray(extraVaultTokens) ? extraVaultTokens : [])
  ].filter(t => /^[a-zA-Z0-9_-]{16,256}$/.test(t)))).slice(0, 8);

  res.setHeader('Set-Cookie', [
    `storm_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`,
    `storm_vault=${combinedVault.join('.')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`
  ]);
}

export function clearSecureSessionCookie(res, req = null, remainingVaultTokens = null) {
  if (!res) return;
  const maxAge = 30 * 24 * 3600;
  const secureFlag = isRequestSecure(req) ? '; Secure' : '';
  const cookies = ['storm_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'];
  if (Array.isArray(remainingVaultTokens)) {
    const cleanList = Array.from(new Set(remainingVaultTokens.map(t => String(t || '').trim()).filter(t => /^[a-zA-Z0-9_-]{16,256}$/.test(t)))).slice(0, 8);
    if (cleanList.length > 0) {
      cookies.push(`storm_vault=${cleanList.join('.')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`);
    } else {
      cookies.push('storm_vault=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    }
  }
  res.setHeader('Set-Cookie', cookies);
}

export function escapeHtmlEntities(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeXSS(input) {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input
      .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
      .replace(/<\s*script[^>]*>/gi, '')
      .replace(/\bon\w+\s*=\s*(['"]?[^'"]*['"]?)/gi, '')
      .replace(/javascript\s*:/gi, '');
  }
  if (Array.isArray(input)) {
    return input.map(item => sanitizeXSS(item));
  }
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = sanitizeXSS(v);
    }
    return out;
  }
  return input;
}

export function validatePayload(schemaName, payload) {
  const data = sanitizeXSS(payload || {});
  switch (schemaName) {
    case 'progress': {
      const media_id = String(data.media_id || data.id || '').trim();
      const title = String(data.title || '').trim();
      if (!media_id || !title) {
        return { valid: false, error: 'Не указан media_id или название фильма/сериала' };
      }
      return {
        valid: true,
        data: {
          ...data,
          media_id: media_id.slice(0, 128),
          title: title.slice(0, 256),
          progress_seconds: Math.max(0, Number(data.progress_seconds ?? data.time_seconds ?? 0) || 0),
          duration_seconds: Math.max(0, Number(data.duration_seconds ?? 0) || 0)
        }
      };
    }
    case 'subscription': {
      const media_id = String(data.media_id || '').trim();
      if (!media_id) {
        return { valid: false, error: 'Не указан идентификатор релиза (media_id)' };
      }
      return {
        valid: true,
        data: {
          ...data,
          media_id: media_id.slice(0, 128),
          title: String(data.title || 'Релиз').trim().slice(0, 256)
        }
      };
    }
    default:
      return { valid: true, data };
  }
}

export function validateBodyMiddleware(schemaName) {
  return (req, res, next) => {
    const result = validatePayload(schemaName, req.body);
    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }
    req.validatedBody = result.data;
    next();
  };
}

export function parseDeviceNameFromUserAgent(ua = '') {
  const s = String(ua || '');
  if (!s) return 'Неизвестное устройство';
  let os = 'Устройство';
  if (/Android.*TV|BRAVIA|AFT|SmartTV|Tizen|Web0S/i.test(s)) os = 'Smart TV';
  else if (/Windows/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iOS/i.test(s)) os = 'iOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/Macintosh|Mac OS X/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';

  let browser = '';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Safari\//i.test(s)) browser = 'Safari';

  return browser ? `${os} • ${browser}` : os;
}
