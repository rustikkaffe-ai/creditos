(function () {
  "use strict";
  const N = window.Nucleo, $ = (id) => document.getElementById(id);
  let llave = null, filas = [], visibles = [];
  const marcados = new Set();

  const dos = (n) => String(n).padStart(2, "0");
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`; };
  async function bajar(ruta) {
    const r = await fetch(ruta, { cache: "no-store" });
    if (!r.ok) throw new Error(ruta + " (" + r.status + ")");
    return new Uint8Array(await r.arrayBuffer());
  }
  const msg = (el, texto, tipo) => { el.textContent = texto || ""; el.className = "mensaje" + (tipo ? " " + tipo : ""); };

  async function entrar() {
    const clave = $("clave").value;
    if (!clave) return msg($("msgEntrada"), "Escribe la clave.", "error");
    $("entrar").disabled = true; msg($("msgEntrada"), "Abriendo…");
    try {
      const candado = JSON.parse(new TextDecoder().decode(await bajar("datos/candado.json")));
      llave = await N.abrirCandado(candado, clave);
      if (!llave) { msg($("msgEntrada"), "Esa clave no abre la página. Revísala y prueba otra vez.", "error"); $("entrar").disabled = false; return; }
      const indice = await N.deJson(llave, await bajar("datos/indice.enc"));
      filas = indice.filas || [];
      $("actualizado").textContent = "Última actualización: " + (indice.actualizado || "sin datos") + " · " + filas.length + " créditos guardados";
      $("clave").value = "";
      $("entrada").hidden = true; $("app").hidden = false; $("barra").hidden = false;
      llenarEmpresas(); pintar();
    } catch (e) {
      msg($("msgEntrada"), "No pude abrir los datos: " + e.message + ". Si es la primera vez, puede que aún no se haya publicado ninguna actualización.", "error");
      $("entrar").disabled = false;
    }
  }

  function llenarEmpresas() {
    const sel = $("empresa"), nombres = [...new Set(filas.map((f) => f.empresa).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    for (const n of nombres) { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); }
  }
  const filtros = () => ({ desde: $("desde").value, hasta: $("hasta").value, empresa: $("empresa").value, texto: $("texto").value });

  function celda(tr, texto, clase) { const td = document.createElement("td"); td.textContent = texto; if (clase) td.className = clase; tr.appendChild(td); return td; }
  function celdaDinero(tr, v) { return celda(tr, N.dinero(v), "num" + (v === null || v === undefined ? " sd" : "")); }

  function pintar() {
    visibles = N.filtrar(filas, filtros());
    const cuerpo = $("filas"); cuerpo.textContent = "";
    for (const f of visibles) {
      const tr = document.createElement("tr"); if (marcados.has(f.id)) tr.className = "marcada";
      const c = document.createElement("td"), cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = marcados.has(f.id); cb.setAttribute("aria-label", "Marcar " + (f.numeroControl || f.id));
      cb.addEventListener("change", () => { cb.checked ? marcados.add(f.id) : marcados.delete(f.id); pintar(); });
      c.appendChild(cb); tr.appendChild(c);
      celda(tr, f.fecha || "sin datos", f.fecha ? "" : "sd");
      const te = celda(tr, f.empresa || "sin datos", f.empresa ? "" : "sd");
      for (const a of f.aviso || []) { const s = document.createElement("span"); s.className = "aviso"; s.textContent = "Revisar: " + a; te.appendChild(s); }
      celda(tr, f.numeroControl || "sin datos", f.numeroControl ? "" : "sd");
      celdaDinero(tr, f.neto); celdaDinero(tr, f.iva); celdaDinero(tr, f.total);
      cuerpo.appendChild(tr);
    }
    $("vacio").hidden = visibles.length > 0;
    $("todos").checked = visibles.length > 0 && visibles.every((f) => marcados.has(f.id));
    const sel = filas.filter((f) => marcados.has(f.id)), t = N.sumar(sel);
    $("totales").innerHTML = "";
    const l1 = document.createElement("div"); l1.textContent = `Se ven ${visibles.length} · Marcados ${sel.length}`;
    const l2 = document.createElement("div"); l2.append("Marcados: neto " + N.dinero(t.neto) + " · IVA " + N.dinero(t.iva) + " · total ");
    const b = document.createElement("b"); b.textContent = N.dinero(t.total); l2.appendChild(b);
    $("totales").append(l1, l2);
    if (t.sinDatos) { const l3 = document.createElement("div"); l3.className = "aviso"; l3.textContent = t.sinDatos + " de los marcados tienen algún monto sin datos: la suma no los incluye."; $("totales").appendChild(l3); }
    $("bajarZip").disabled = sel.length === 0;
  }

  function guardar(bytes, nombre, tipo) {
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo })), a = document.createElement("a");
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function descargarZip() {
    const sel = filas.filter((f) => marcados.has(f.id)); if (!sel.length) return;
    $("bajarZip").disabled = true; const usados = new Set(), archivos = [];
    try {
      for (let i = 0; i < sel.length; i++) {
        msg($("msgAccion"), `Descargando ${i + 1} de ${sel.length}…`);
        if (!/^[A-Za-z0-9-]+$/.test(sel[i].id)) throw new Error("identificador raro en " + sel[i].id);
        const pdf = await N.descifrar(llave, await bajar("pdf/" + sel[i].id + ".pdf.enc"));
        if (String.fromCharCode(...pdf.slice(0, 4)) !== "%PDF") throw new Error("el archivo de " + (sel[i].numeroControl || sel[i].id) + " no es un PDF");
        archivos.push({ nombre: N.nombreArchivo(sel[i], usados), datos: pdf });
      }
      const fechas = sel.map((f) => f.fecha).filter(Boolean).sort();
      const nombre = "creditos_" + (fechas[0] || "sin-fecha") + "_a_" + (fechas[fechas.length - 1] || "sin-fecha") + ".zip";
      guardar(N.crearZip(archivos), nombre, "application/zip");
      msg($("msgAccion"), `✓ ${sel.length} PDF en ${nombre}`, "ok");
    } catch (e) {
      msg($("msgAccion"), "✗ No se descargó nada: " + e.message + ". Avisa a Fátima.", "error");
    }
    pintar();
  }

  function descargarCsv() {
    const base = filas.filter((f) => marcados.has(f.id)), usar = base.length ? base : visibles;
    guardar(new TextEncoder().encode(N.csv(usar)), "creditos_" + hoy() + ".csv", "text/csv;charset=utf-8");
    msg($("msgAccion"), `✓ Lista de ${usar.length} créditos${base.length ? " (los marcados)" : " (los que se ven)"}`, "ok");
  }

  $("entrar").addEventListener("click", entrar);
  $("clave").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
  for (const id of ["desde", "hasta", "empresa"]) $(id).addEventListener("change", pintar);
  $("texto").addEventListener("input", pintar);
  $("mesAnt").addEventListener("click", () => { const m = N.mesAnterior(hoy()); $("desde").value = m.desde; $("hasta").value = m.hasta; pintar(); });
  $("todo").addEventListener("click", () => { for (const id of ["desde", "hasta", "empresa", "texto"]) $(id).value = ""; pintar(); });
  $("todos").addEventListener("change", (e) => { for (const f of visibles) e.target.checked ? marcados.add(f.id) : marcados.delete(f.id); pintar(); });
  $("bajarZip").addEventListener("click", descargarZip);
  $("bajarCsv").addEventListener("click", descargarCsv);
})();
