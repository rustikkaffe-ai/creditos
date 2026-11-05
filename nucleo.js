// Motor compartido: lo usan la página (en el navegador) y el kit (en Node).
// Una sola versión de cifrado, filtros, sumas, CSV y ZIP, para que lo probado sea lo que se usa.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(globalThis.crypto);
  else root.Nucleo = factory(root.crypto);
})(typeof self !== "undefined" ? self : this, function (crypto) {
  "use strict";
  const s = crypto.subtle, ITER = 600000, PRUEBA = "creditos-rustik";
  const enc = new TextEncoder(), dec = new TextDecoder();

  const b64 = (u8) => { let t = ""; for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(t); };
  const d64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  const azar = (n) => crypto.getRandomValues(new Uint8Array(n));

  // ---------- Cifrado: PBKDF2-SHA256 (600.000 vueltas) -> AES-256-GCM ----------
  async function derivarLlave(clave, salt, iter) {
    const base = await s.importKey("raw", enc.encode(clave), "PBKDF2", false, ["deriveKey"]);
    return s.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function cifrar(llave, bytes) {            // salida: 12 bytes de IV + texto cifrado
    const iv = azar(12), ct = new Uint8Array(await s.encrypt({ name: "AES-GCM", iv }, llave, bytes));
    const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12); return out;
  }
  async function descifrar(llave, bytes) {
    return new Uint8Array(await s.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, llave, bytes.slice(12)));
  }
  async function crearCandado(clave) {
    const salt = azar(16), llave = await derivarLlave(clave, salt, ITER);
    const prueba = await cifrar(llave, enc.encode(PRUEBA));
    return { candado: { v: 1, kdf: "PBKDF2-SHA256", iter: ITER, salt: b64(salt), prueba: b64(prueba) }, llave };
  }
  async function abrirCandado(candado, clave) {    // devuelve la llave, o null si la clave no es
    try {
      const llave = await derivarLlave(clave, d64(candado.salt), candado.iter);
      return dec.decode(await descifrar(llave, d64(candado.prueba))) === PRUEBA ? llave : null;
    } catch (e) { return null; }
  }
  const aJson = (llave, obj) => cifrar(llave, enc.encode(JSON.stringify(obj)));
  const deJson = async (llave, bytes) => JSON.parse(dec.decode(await descifrar(llave, bytes)));

  // ---------- Dinero: todo en centavos para que las sumas no se desvíen ----------
  const cent = (x) => (x === null || x === undefined ? null : Math.round(Number(x) * 100));
  function sumar(filas) {
    const t = { neto: 0, iva: 0, total: 0, sinDatos: 0 };
    for (const f of filas) {
      if (f.neto === null || f.iva === null || f.total === null) t.sinDatos++;
      t.neto += cent(f.neto) || 0; t.iva += cent(f.iva) || 0; t.total += cent(f.total) || 0;
    }
    return { neto: t.neto / 100, iva: t.iva / 100, total: t.total / 100, sinDatos: t.sinDatos, n: filas.length };
  }
  const dinero = (x) => (x === null || x === undefined ? "sin datos" : "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  // ---------- Fechas (texto AAAA-MM-DD, sin zonas horarias) ----------
  const dos = (n) => String(n).padStart(2, "0");
  function mesAnterior(hoy) {                      // hoy: "AAAA-MM-DD"
    let y = +hoy.slice(0, 4), m = +hoy.slice(5, 7) - 1;
    if (m === 0) { y--; m = 12; }
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { desde: `${y}-${dos(m)}-01`, hasta: `${y}-${dos(m)}-${dos(ultimo)}` };
  }
  const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  function filtrar(filas, f) {                     // todos los filtros son opcionales
    const q = normal(f.texto || "");
    return filas.filter((x) =>
      (!f.desde || (x.fecha && x.fecha >= f.desde)) &&
      (!f.hasta || (x.fecha && x.fecha <= f.hasta)) &&
      (!f.empresa || x.empresa === f.empresa) &&
      (!q || normal([x.empresa, x.numeroControl, x.nit, x.id].join(" ")).includes(q)));
  }

  // ---------- Lista para hoja de cálculo (CSV con acentos que Excel entiende) ----------
  function csv(filas) {
    const cab = ["Fecha", "Empresa", "NIT", "Número de control", "Neto", "IVA", "Retención", "Percepción", "Total a pagar", "Aviso"];
    const c = (v) => { const t = v === null || v === undefined ? "" : String(v); return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const num = (v) => (v === null || v === undefined ? "" : Number(v).toFixed(2));
    const lineas = filas.map((f) => [f.fecha, f.empresa, f.nit, f.numeroControl, num(f.neto), num(f.iva), num(f.retencion), num(f.percepcion), num(f.total), (f.aviso || []).join(" | ")].map(c).join(","));
    return "﻿" + [cab.join(","), ...lineas].join("\r\n") + "\r\n";
  }

  // ---------- Nombre de cada PDF dentro del ZIP ----------
  function nombreArchivo(f, usados) {
    const limpio = (t) => normal(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "sin-empresa";
    let base = `${f.fecha || "sin-fecha"}_${limpio(f.empresa)}_${String(f.numeroControl || f.id).replace(/[^A-Za-z0-9-]/g, "").slice(-12)}`, n = base, i = 2;
    while (usados.has(n)) n = `${base}-${i++}`;
    usados.add(n); return n + ".pdf";
  }

  // ---------- ZIP sin compresión (los PDF ya vienen comprimidos) ----------
  const TABLA = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = TABLA[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function crearZip(archivos) {                    // [{nombre, datos:Uint8Array}] -> Uint8Array
    const partes = [], central = []; let pos = 0;
    for (const a of archivos) {
      const nom = enc.encode(a.nombre), crc = crc32(a.datos), tam = a.datos.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, 0, true); lh.setUint16(12, 33, true); lh.setUint32(14, crc, true); lh.setUint32(18, tam, true); lh.setUint32(22, tam, true);
      lh.setUint16(26, nom.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, 0, true); ch.setUint16(14, 33, true); ch.setUint32(16, crc, true); ch.setUint32(20, tam, true); ch.setUint32(24, tam, true);
      ch.setUint16(28, nom.length, true); ch.setUint32(42, pos, true);
      partes.push(new Uint8Array(lh.buffer), nom, a.datos); central.push(new Uint8Array(ch.buffer), nom);
      pos += 30 + nom.length + tam;
    }
    const tamCentral = central.reduce((s2, p) => s2 + p.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tamCentral, true); fin.setUint32(16, pos, true);
    const todo = [...partes, ...central, new Uint8Array(fin.buffer)], out = new Uint8Array(pos + tamCentral + 22);
    let o = 0; for (const p of todo) { out.set(p, o); o += p.length; }
    return out;
  }

  return { ITER, b64, d64, derivarLlave, cifrar, descifrar, crearCandado, abrirCandado, aJson, deJson, cent, sumar, dinero, mesAnterior, normal, filtrar, csv, nombreArchivo, crc32, crearZip };
});
