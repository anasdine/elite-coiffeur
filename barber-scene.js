/* <barber-scene> — « La station », three.js vanilla. v4
   Scène 3D procédurale sans asset externe. Host fixed/inset:0/pointer-events:none.
   v4 : voyage de caméra sur spline entre cinq points d'étape (un par section, lus dans
   le DOM via [data-sec]), objet vedette par étape, actions d'outil pendant les vols
   (rasoir qui se déplie, tondeuse qui vibre, ciseaux qui respirent), table et brouillard,
   passe de post-traitement (aberration chromatique liée à la vitesse, grain, vignette,
   tone mapping ACES), séquence d'intro temps réel. */
(() => {
  if (customElements.get('barber-scene')) return;

  // bibliothèque servie depuis le site lui-même ; les CDN ne sont que des secours
  const SOURCES = [
    new URL('./vendor/three.module.min.js', document.baseURI).href,
    'https://esm.sh/three@0.169.0',
    'https://unpkg.com/three@0.169.0/build/three.module.js'
  ];
  let threeP = null;
  const loadThree = () => threeP || (threeP = (async () => {
    let last = null;
    for (const src of SOURCES) {
      try { const m = await import(src); if (m && m.Scene) return m; } catch (e) { last = e; }
    }
    throw last || new Error('three indisponible');
  })());

  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const dampf = (c, t, k, dt) => c + (t - c) * (1 - Math.pow(1 - k, Math.min(dt, 0.1) * 60));
  const out3 = t => 1 - Math.pow(1 - t, 3);
  const outExpo = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  const backOut = t => { const s = 0.55; const u = t - 1; return 1 + u * u * ((s + 1) * u + s); };
  const mix = (a, b, t) => a + (b - a) * t;
  // interpolation lissée entre valeurs clés posées aux entiers t = 0..n
  const keyLerp = (keys, t) => {
    const n = keys.length - 1;
    if (t <= 0) return keys[0];
    if (t >= n) return keys[n];
    const i = Math.floor(t);
    return mix(keys[i], keys[i + 1], sstep(0, 1, t - i));
  };

  /* ---------- textures procédurales ---------- */

  function brushedTex(T) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1400; i++) {
      const y = Math.random() * 512, len = 40 + Math.random() * 320, x0 = Math.random() * 512;
      const g = Math.floor(80 + Math.random() * 110);
      x.strokeStyle = 'rgba(' + g + ',' + g + ',' + g + ',' + (0.18 + Math.random() * 0.3).toFixed(2) + ')';
      x.lineWidth = Math.random() < 0.85 ? 1 : 2;
      x.beginPath(); x.moveTo(x0 - len / 2, y); x.lineTo(x0 + len / 2, y); x.stroke();
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }

  // normal map « acier brossé » : rayures longitudinales fines, dérivée du champ de hauteur
  function filterTex(t, T, aniso) {
    t.generateMipmaps = true;
    t.minFilter = T.LinearMipmapLinearFilter;
    t.magFilter = T.LinearFilter;
    t.anisotropy = aniso || 8;
    t.needsUpdate = true;
    return t;
  }

  function brushedNormal(T) {
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#808080'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 3200; i++) {
      const y = Math.random() * N, len = 20 + Math.random() * 400, x0 = Math.random() * N;
      const g = Math.floor(60 + Math.random() * 140);
      x.strokeStyle = 'rgba(' + g + ',' + g + ',' + g + ',' + (0.2 + Math.random() * 0.5).toFixed(2) + ')';
      x.lineWidth = Math.random() < 0.9 ? 1 : 2;
      x.beginPath(); x.moveTo(x0 - len / 2, y); x.lineTo(x0 + len / 2, y); x.stroke();
    }
    const h = x.getImageData(0, 0, N, N).data;
    const out = x.createImageData(N, N);
    const H = (i, j) => h[(((j + N) % N) * N + ((i + N) % N)) * 4] / 255;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const dx = (H(i + 1, j) - H(i - 1, j)) * 1.6, dy = (H(i, j + 1) - H(i, j - 1)) * 1.6;
      const l = Math.hypot(dx, dy, 1);
      const k = (j * N + i) * 4;
      out.data[k] = (-dx / l * 0.5 + 0.5) * 255; out.data[k + 1] = (-dy / l * 0.5 + 0.5) * 255; out.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[k + 3] = 255;
    }
    x.putImageData(out, 0, 0);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(3, 3);
    return t;
  }

  // cuir de table : grain cellulaire + pores, couleur et rugosité
  function leatherTex(T) {
    const N = 1024, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#0c0907'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 26000; i++) {
      const r = 3 + Math.random() * 9;
      const v = Math.random();
      x.fillStyle = v < 0.5 ? 'rgba(24,17,13,' + (0.15 + Math.random() * 0.25).toFixed(2) + ')' : 'rgba(8,6,5,' + (0.2 + Math.random() * 0.3).toFixed(2) + ')';
      x.beginPath(); x.ellipse(Math.random() * N, Math.random() * N, r, r * (0.6 + Math.random() * 0.4), Math.random() * Math.PI, 0, Math.PI * 2); x.fill();
    }
    for (let i = 0; i < 9000; i++) {
      x.fillStyle = 'rgba(0,0,0,' + (0.3 + Math.random() * 0.4).toFixed(2) + ')';
      x.fillRect(Math.random() * N, Math.random() * N, 1.5, 1.5);
    }
    // couture périmétrique
    x.strokeStyle = 'rgba(70,54,40,0.7)'; x.lineWidth = 2; x.setLineDash([10, 9]);
    x.strokeRect(46, 46, N - 92, N - 92);
    const t = new T.CanvasTexture(c);
    if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  function leatherRough(T) {
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 12000; i++) {
      const r = 2 + Math.random() * 5, g = Math.floor(110 + Math.random() * 110);
      x.fillStyle = 'rgba(' + g + ',' + g + ',' + g + ',0.45)';
      x.beginPath(); x.arc(Math.random() * N, Math.random() * N, r, 0, Math.PI * 2); x.fill();
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(3, 3);
    return t;
  }

  function marbleTex(T) {
    const N = 1024, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, N, N);
    g.addColorStop(0, '#1b1916'); g.addColorStop(0.5, '#141210'); g.addColorStop(1, '#1e1b17');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    // veines : marches aléatoires, deux passes d'épaisseur
    const vein = (n, w, a, col) => {
      for (let i = 0; i < n; i++) {
        let px = Math.random() * N, py = -20;
        x.strokeStyle = col.replace('A', (a * (0.5 + Math.random() * 0.5)).toFixed(2));
        x.lineWidth = w * (0.5 + Math.random());
        x.beginPath(); x.moveTo(px, py);
        while (py < N + 20) { px += (Math.random() - 0.5) * 46; py += 14 + Math.random() * 18; x.lineTo(px, py); }
        x.stroke();
      }
    };
    vein(7, 3.0, 0.16, 'rgba(198,189,174,A)');
    vein(14, 1.3, 0.13, 'rgba(160,152,138,A)');
    vein(6, 0.8, 0.2, 'rgba(226,219,206,A)');
    for (let i = 0; i < 24000; i++) {
      x.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.025).toFixed(3) + ')';
      x.fillRect(Math.random() * N, Math.random() * N, 1.5, 1.5);
    }
    const t = new T.CanvasTexture(c);
    if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  // mur du fond : plâtre chaud, lumière rasante venant du haut
  function wallTex(T) {
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, N);
    g.addColorStop(0, '#6a5747'); g.addColorStop(0.42, '#42362c'); g.addColorStop(1, '#171210');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 30000; i++) {
      const v = Math.random() < 0.5 ? 255 : 0;
      x.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (Math.random() * 0.045).toFixed(3) + ')';
      x.fillRect(Math.random() * N, Math.random() * N, 2, 2);
    }
    const t = new T.CanvasTexture(c);
    if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
    return t;
  }

  // masque de fondu : le tapis s'efface vers ses bords, pas d'arête visible
  function fadeMask(T) {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, N, N);
    const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    g.addColorStop(0, '#fff'); g.addColorStop(0.52, '#fff'); g.addColorStop(0.78, '#6a6a6a'); g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(0, 0, N, N);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    return t;
  }

  // paillettes dans la résine noire : petites taches claires
  function fleckTex(T) {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.fillStyle = '#0d0b0a'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 900; i++) {
      x.fillStyle = 'rgba(' + (60 + Math.random() * 50 | 0) + ',' + (48 + Math.random() * 30 | 0) + ',' + (36 + Math.random() * 20 | 0) + ',' + (0.3 + Math.random() * 0.6).toFixed(2) + ')';
      x.fillRect(Math.random() * N, Math.random() * N, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
    }
    const t = new T.CanvasTexture(c);
    if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(4, 4);
    return t;
  }

  function glowPlane(T, rgb, peak) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(256, 256, 0, 256, 256, 256);
    g.addColorStop(0, 'rgba(' + rgb + ',' + peak + ')');
    g.addColorStop(0.3, 'rgba(' + rgb + ',' + (peak * 0.55).toFixed(3) + ')');
    g.addColorStop(0.55, 'rgba(' + rgb + ',' + (peak * 0.24).toFixed(3) + ')');
    g.addColorStop(0.78, 'rgba(' + rgb + ',' + (peak * 0.07).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, 512, 512);
    // micro-bruit : casse le banding du dégradé sur fond sombre
    for (let i = 0; i < 2600; i++) {
      x.fillStyle = 'rgba(' + rgb + ',' + (Math.random() * 0.03).toFixed(3) + ')';
      x.fillRect(Math.random() * 512, Math.random() * 512, 1, 1);
    }
    const tex = new T.CanvasTexture(c);
    if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
    const m = new T.Mesh(
      new T.PlaneGeometry(1, 1),
      new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false })
    );
    m.renderOrder = -2;
    return m;
  }

  /* ---------- géométrie : lofts paramétriques ---------- */

  // balaye une section 2D fermée le long de N tranches : sectionAt(u) -> { c, ax, ay, pts }
  function loft(T, N, sectionAt) {
    const pos = [], idx = [];
    let M = 0;
    for (let i = 0; i <= N; i++) {
      const s = sectionAt(i / N);
      M = s.pts.length;
      for (const [px, py] of s.pts) {
        pos.push(
          s.c.x + s.ax.x * px + s.ay.x * py,
          s.c.y + s.ax.y * px + s.ay.y * py,
          s.c.z + s.ax.z * px + s.ay.z * py
        );
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const a = i * M + j, b = i * M + (j + 1) % M, c = (i + 1) * M + j, d = (i + 1) * M + (j + 1) % M;
        idx.push(a, c, b, b, c, d);
      }
    }
    const cap = (i0, flip) => {
      // copie des sommets de l'anneau : le capuchon garde ses propres normales
      const ring = [];
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < M; j++) {
        const k = (i0 * M + j) * 3;
        ring.push(pos.length / 3);
        pos.push(pos[k], pos[k + 1], pos[k + 2]);
        cx += pos[k]; cy += pos[k + 1]; cz += pos[k + 2];
      }
      const c = pos.length / 3;
      pos.push(cx / M, cy / M, cz / M);
      for (let j = 0; j < M; j++) {
        const a = ring[j], b = ring[(j + 1) % M];
        if (flip) idx.push(c, b, a); else idx.push(c, a, b);
      }
    };
    cap(0, false); cap(N, true);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const scalePts = (pts, sx, sy) => pts.map(([x, y]) => [x * sx, y * sy]);
  // section « rectangle arrondi » (superellipse n = 4)
  const SUPER = (() => {
    const p = [];
    for (let j = 0; j < 28; j++) {
      const a = j / 28 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      p.push([Math.sign(c) * Math.pow(Math.abs(c), 0.5), Math.sign(s) * Math.pow(Math.abs(s), 0.5)]);
    }
    return p;
  })();
  // lame de ciseaux : fil (x = +1), face extérieure convexe, dos arrondi, face intérieure évidée
  const SHEAR_SEC = [
    [1, 0], [0.88, 0.09], [0.62, 0.26], [0.3, 0.4], [0.02, 0.47], [-0.36, 0.5], [-0.72, 0.47], [-0.96, 0.36], [-1.06, 0.18],
    [-1.06, -0.1], [-0.96, -0.22], [-0.7, -0.24], [-0.36, -0.2], [0.02, -0.16], [0.4, -0.11], [0.74, -0.05], [0.9, -0.02]
  ];
  // lame de rasoir : évidée des deux côtés, dos épais et rond
  const RAZOR_SEC = [
    [1, 0], [0.82, 0.06], [0.5, 0.13], [0.1, 0.22], [-0.3, 0.32], [-0.68, 0.44], [-0.92, 0.5], [-1.06, 0.3], [-1.08, 0],
    [-1.06, -0.3], [-0.92, -0.5], [-0.68, -0.44], [-0.3, -0.32], [0.1, -0.22], [0.5, -0.13], [0.82, -0.06]
  ];

  function ext(T, shape, depth, seg) {
    const g = new T.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: seg || 10,
      bevelEnabled: true, bevelThickness: depth * 0.2, bevelSize: depth * 0.2, bevelSegments: 2
    });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals();
    return g;
  }

  /* ciseaux de coiffeur : deux moitiés pivotant en z, lames creuses effilées,
     branches divergentes, anneaux décalés, ergot, butée silencieuse, vis de réglage */
  function shearHalf(T, M, sign, ringR, withRest) {
    const V = (x, y, z) => new T.Vector3(x, y, z);
    const h = new T.Group();
    const BL = 1.3, BW = 0.19, BT = 0.05, SH = 0.6;
    const blade = new T.Mesh(loft(T, 72, u => {
      const w = BW * (1 - 0.3 * u) * Math.sqrt(Math.max(0, 1 - Math.pow(u, 7)));
      const t = BT * (1 - 0.55 * u);
      return {
        c: V(0.04 + BL * u, -sign * (0.012 * Math.sin(Math.PI * u) - 0.03 * u * u), 0),
        ax: V(0, -sign, 0), ay: V(0, 0, sign),
        pts: scalePts(SHEAR_SEC, w / 2, t / 2)
      };
    }), M.steel);
    h.add(blade);
    // biseau de fil : bande polie très fine le long du tranchant, qui accroche la lumière
    const bevel = new T.Mesh(loft(T, 72, u => {
      const w = BW * (1 - 0.3 * u) * Math.sqrt(Math.max(0, 1 - Math.pow(u, 7)));
      const t = BT * (1 - 0.55 * u);
      const c = V(0.04 + BL * u, -sign * (0.012 * Math.sin(Math.PI * u) - 0.03 * u * u), 0);
      const ax = V(0, -sign, 0), ay = V(0, 0, sign);
      return { c: c.clone().addScaledVector(ax, w / 2 - 0.012), ax, ay, pts: scalePts(SUPER, 0.013, t * 0.42) };
    }), M.steelPolished);
    h.add(bevel);
    // ligne de dos : arête sombre qui dessine la silhouette de la lame
    const spine = new T.Mesh(loft(T, 60, u => {
      const w = BW * (1 - 0.3 * u) * Math.sqrt(Math.max(0, 1 - Math.pow(u, 7)));
      const t = BT * (1 - 0.55 * u);
      const c = V(0.04 + BL * u, -sign * (0.012 * Math.sin(Math.PI * u) - 0.03 * u * u), 0);
      const ax = V(0, -sign, 0), ay = V(0, 0, sign);
      return { c: c.clone().addScaledVector(ax, -w / 2 + 0.006), ax, ay, pts: scalePts(SUPER, 0.007, t * 0.36) };
    }), M.steelDark);
    h.add(spine);
    const shank = new T.Mesh(loft(T, 26, u => {
      const w = 0.15 - 0.055 * u, t = BT * 0.9 - 0.008 * u;
      return {
        c: V(-0.07 - SH * u, -sign * (0.012 + 0.115 * Math.pow(u, 1.45)), 0),
        ax: V(0, 1, 0), ay: V(0, 0, 1),
        pts: scalePts(SUPER, w / 2, t / 2)
      };
    }), M.steel);
    h.add(shank);
    const boss = new T.Mesh(new T.CylinderGeometry(0.115, 0.115, BT, 64), M.steelPolished);
    boss.rotation.x = Math.PI / 2; h.add(boss);
    // gravure circulaire autour du pivot
    const engr = new T.Mesh(new T.TorusGeometry(0.095, 0.003, 8, 64), M.steelDark);
    engr.position.z = sign * (BT / 2 + 0.004); h.add(engr);
    const rx = -(0.07 + SH) - ringR * 0.82, ry = -sign * (0.127 + ringR * 0.3);
    const ring = new T.Mesh(new T.TorusGeometry(ringR, 0.036, 24, 96), M.steel);
    ring.position.set(rx, ry, 0); ring.scale.z = 0.78; h.add(ring);
    // garniture intérieure en caoutchouc, comme sur les ciseaux de coiffeur
    const insert = new T.Mesh(new T.TorusGeometry(ringR - 0.036, 0.02, 16, 96), M.rubber);
    insert.position.set(rx, ry, 0); insert.scale.z = 0.6; h.add(insert);
    if (withRest) {
      const rest = new T.Mesh(new T.CylinderGeometry(0.014, 0.021, 0.15, 14), M.steel);
      rest.position.set(rx + ringR * 0.62, ry - sign * (ringR + 0.045), 0);
      rest.rotation.z = sign * 0.62; h.add(rest);
      const tip = new T.Mesh(new T.SphereGeometry(0.017, 14, 10), M.steel);
      tip.position.set(rx + ringR * 0.62 - Math.sin(sign * 0.62) * 0.075, ry - sign * (ringR + 0.045) - Math.cos(0.62) * 0.075 * sign, 0);
      h.add(tip);
    } else {
      // butée silencieuse côté intérieur de la branche
      const bump = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.062, 16), M.rubber);
      bump.rotation.x = Math.PI / 2;
      bump.position.set(-0.07 - SH * 0.9, -sign * 0.05, -sign * 0.03);
      h.add(bump);
    }
    h.position.z = sign * 0.032;
    return h;
  }

  function makeScissors(T, M) {
    const g = new T.Group();
    const a = shearHalf(T, M, 1, 0.175, false);
    const b = shearHalf(T, M, -1, 0.205, true);
    g.add(a); g.add(b);
    // molette de tension crantée : disque poli, couronne de crans, bouton central laiton
    const screw = new T.Mesh(new T.CylinderGeometry(0.064, 0.066, 0.026, 64), M.steelPolished);
    screw.rotation.x = Math.PI / 2; screw.position.z = 0.072; g.add(screw);
    const knurl = new T.InstancedMesh(new T.BoxGeometry(0.012, 0.014, 0.024), M.steelDark, 22);
    { const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), sc = new T.Vector3(1, 1, 1);
      for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2; p.set(Math.cos(a) * 0.066, Math.sin(a) * 0.066, 0.072); q.setFromAxisAngle(new T.Vector3(0, 0, 1), a); m.compose(p, q, sc); knurl.setMatrixAt(i, m); }
      knurl.instanceMatrix.needsUpdate = true; g.add(knurl); }
    const dome = new T.Mesh(new T.SphereGeometry(0.03, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), M.brass);
    dome.rotation.x = Math.PI / 2; dome.scale.z = 0.5; dome.position.z = 0.085; g.add(dome);
    const nut = new T.Mesh(new T.CylinderGeometry(0.052, 0.052, 0.022, 48), M.steelDark);
    nut.rotation.x = Math.PI / 2; nut.position.z = -0.068; g.add(nut);
    g.userData.halves = [a, b];
    return g;
  }

  /* rasoir droit ouvert à 160° : lame à pointe ronde, soie à queue, châsses en deux plaques rivetées */
  function makeRazor(T, M) {
    const V = (x, y, z) => new T.Vector3(x, y, z);
    const g = new T.Group();
    const L = 0.98, W = 0.3, TH = 0.062;
    const blade = new T.Mesh(loft(T, 72, u => {
      const u0 = 0.84;
      const w = W * (u <= u0 ? 1 : Math.sqrt(Math.max(0.0004, 1 - Math.pow((u - u0) / (1 - u0), 2))));
      return { c: V(0.05 + L * u, (W - w) / 2, 0), ax: V(0, -1, 0), ay: V(0, 0, 1), pts: scalePts(RAZOR_SEC, w / 2, TH / 2) };
    }), M.steelPolished);
    g.add(blade);
    const shank = new T.Mesh(loft(T, 22, u => {
      const y = u > 0.45 ? -0.2 * Math.pow((u - 0.45) / 0.55, 1.6) : 0;
      const w = 0.115 - 0.035 * u;
      return { c: V(0.06 - 0.56 * u, y, 0), ax: V(0, 1, 0), ay: V(0, 0, 1), pts: scalePts(SUPER, w / 2, 0.026) };
    }), M.steel);
    g.add(shank);
    const handle = new T.Group();
    handle.position.set(-0.2, 0, 0);
    handle.rotation.z = 20 * Math.PI / 180;
    const scale = z => new T.Mesh(loft(T, 28, u => {
      const w = 0.17 + 0.05 * Math.sin(Math.PI * u);
      const end = u > 0.92 ? Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.92) / 0.08, 2)))
        : u < 0.06 ? Math.sqrt(Math.max(0, 1 - Math.pow((0.06 - u) / 0.06, 2))) : 1;
      return { c: V(-1.06 * u, -0.045 * Math.sin(Math.PI * u), z), ax: V(0, 1, 0), ay: V(0, 0, 1), pts: scalePts(SUPER, Math.max(0.004, w / 2 * end), 0.011) };
    }), M.resinFleck);
    handle.add(scale(0.055)); handle.add(scale(-0.055));
    // entretoise laiton entre les deux écailles, côté pointe
    const spacer = new T.Mesh(new T.BoxGeometry(0.16, 0.04, 0.09), M.brass);
    spacer.position.set(-0.55, -0.05, 0); handle.add(spacer);
    const pin = (x, y) => {
      const p = new T.Mesh(new T.CylinderGeometry(0.019, 0.019, 0.142, 32), M.brass);
      const cap1 = new T.Mesh(new T.SphereGeometry(0.021, 24, 12), M.brass); cap1.position.set(x, y, 0.071); cap1.scale.z = 0.5; handle.add(cap1);
      const cap2 = new T.Mesh(new T.SphereGeometry(0.021, 24, 12), M.brass); cap2.position.set(x, y, -0.071); cap2.scale.z = 0.5; handle.add(cap2);
      p.rotation.x = Math.PI / 2; p.position.set(x, y, 0); handle.add(p);
    };
    pin(0, 0); pin(-0.97, 0.01);
    const wedge = new T.Mesh(new T.BoxGeometry(0.09, 0.08, 0.088), M.brass);
    wedge.position.set(-0.95, 0, 0); handle.add(wedge);
    g.add(handle);
    g.userData.handle = handle;
    return g;
  }

  /* tondeuse professionnelle : boîtier moulé à flancs plats (loft de sections
     superellipse), collier chromé, lame de coupe inclinée à deux peignes dentés,
     levier de dégradé latéral, interrupteur à glissière, grilles d'aération */
  function makeClipper(T, M) {
    const g = new T.Group();
    // interpolation lissée entre points clés du profil
    const kv = (keys, u) => {
      for (let i = 1; i < keys.length; i++) {
        if (u <= keys[i][0] || i === keys.length - 1) {
          const [u0, v0] = keys[i - 1], [u1, v1] = keys[i];
          const t = Math.min(1, Math.max(0, (u - u0) / (u1 - u0)));
          return v0 + (v1 - v0) * t * t * (3 - 2 * t);
        }
      }
      return keys[0][1];
    };
    // section du boîtier : flancs quasi plats, arêtes adoucies
    const SEC = (() => {
      const p = [];
      for (let j = 0; j < 40; j++) {
        const a = j / 40 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        p.push([Math.sign(c) * Math.pow(Math.abs(c), 0.34), Math.sign(s) * Math.pow(Math.abs(s), 0.44)]);
      }
      return p;
    })();
    const TOP = [[0, 0.104], [0.09, 0.148], [0.5, 0.152], [1, 0.114]];
    const BOT = [[0, -0.082], [0.1, -0.14], [0.4, -0.164], [0.78, -0.126], [1, -0.08]];
    const WID = [[0, 0.078], [0.1, 0.12], [0.45, 0.132], [0.8, 0.112], [1, 0.084]];
    const X0 = -0.42, X1 = 0.3, SPAN = X1 - X0;
    const halfW = x => kv(WID, (x - X0) / SPAN);
    const topY = x => kv(TOP, (x - X0) / SPAN);
    const sec = (u, grow) => {
      const top = kv(TOP, u), bot = kv(BOT, u), w = kv(WID, u);
      const cap = u < 0.05 ? 0.62 + 0.38 * Math.sin(u / 0.05 * Math.PI / 2) : 1;
      return {
        c: new T.Vector3(X0 + SPAN * u, (top + bot) / 2, 0),
        ax: new T.Vector3(0, 0, 1), ay: new T.Vector3(0, 1, 0),
        pts: SEC.map(([a, b]) => [a * w * cap * grow, b * (top - bot) / 2 * cap * grow])
      };
    };
    g.add(new T.Mesh(loft(T, 48, u => sec(u, 1)), M.resin));
    // collier chromé à la jonction boîtier / tête
    g.add(new T.Mesh(loft(T, 6, u => sec(0.9 + 0.09 * u, 1.022)), M.steelPolished));
    // panneaux caoutchouc en creux sur les flancs, pour la prise
    for (const sz of [-1, 1]) {
      const pad = new T.Mesh(new T.BoxGeometry(0.2, 0.15, 0.01), M.rubber);
      pad.position.set(-0.13, -0.01, sz * (halfW(-0.13) - 0.002));
      g.add(pad);
      for (let i = 0; i < 7; i++) {
        const rib = new T.Mesh(new T.BoxGeometry(0.008, 0.13, 0.008), M.resin);
        rib.position.set(-0.212 + i * 0.028, -0.01, sz * (halfW(-0.13) + 0.003));
        g.add(rib);
      }
    }
    // grilles d'aération : fentes sombres en retrait vers l'arrière
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const sl = new T.Mesh(new T.BoxGeometry(0.009, 0.062, 0.014), M.steelDark);
        sl.position.set(-0.335 + i * 0.026, 0.05, sz * (halfW(-0.33) - 0.004));
        g.add(sl);
      }
    }
    // plaque de marque : bandeau laiton fin sur le flanc droit
    const plaque = new T.Mesh(new T.BoxGeometry(0.16, 0.034, 0.006), M.brass);
    plaque.position.set(-0.02, 0.055, halfW(-0.02) - 0.001); g.add(plaque);
    const plaqueRing = new T.Mesh(new T.TorusGeometry(0.012, 0.0016, 8, 40), M.steelDark);
    plaqueRing.position.set(-0.075, 0.055, halfW(-0.02) + 0.004); g.add(plaqueRing);
    // interrupteur à glissière : rail en creux sur la face supérieure
    const rail = new T.Mesh(new T.BoxGeometry(0.115, 0.016, 0.05), M.steelDark);
    rail.position.set(-0.02, topY(-0.02) - 0.008, 0); g.add(rail);
    const slider = new T.Mesh(new T.BoxGeometry(0.048, 0.022, 0.044), M.steelPolished);
    slider.position.set(0.006, topY(-0.02) + 0.002, 0); g.add(slider);
    for (let i = 0; i < 3; i++) {
      const gr = new T.Mesh(new T.BoxGeometry(0.005, 0.005, 0.04), M.steelDark);
      gr.position.set(-0.006 + i * 0.012, topY(-0.02) + 0.012, 0); g.add(gr);
    }
    // témoin de charge
    const led = new T.Mesh(new T.SphereGeometry(0.0055, 16, 12), new T.MeshBasicMaterial({ color: 0xffb060 }));
    led.position.set(0.15, topY(0.15) - 0.004, 0.04); g.add(led); g.userData.led = led;
    // contacts de charge sur le talon
    for (const sz of [-1, 1]) {
      const pin = new T.Mesh(new T.CylinderGeometry(0.009, 0.009, 0.01, 20), M.brass);
      pin.rotation.z = Math.PI / 2; pin.position.set(-0.424, -0.01, sz * 0.03); g.add(pin);
    }

    /* tête de coupe : socle, lame fixe dentée, peigne mobile, vis et ressort */
    const head = new T.Group();
    head.position.set(0.268, 0.056, 0); head.rotation.z = 0.1;
    // socle de lame en résine sombre
    const seat = new T.Mesh(new T.BoxGeometry(0.075, 0.072, 0.216), M.steelDark);
    seat.position.set(0.026, -0.012, 0); head.add(seat);
    // lame fixe : plaque acier biseautée vers la pointe
    const fixed = new T.Mesh(loft(T, 6, u => ({
      c: new T.Vector3(0.02 + 0.16 * u, 0, 0), ax: new T.Vector3(0, 1, 0), ay: new T.Vector3(0, 0, 1),
      pts: [[1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => [
        a * (u > 0.55 ? 0.0055 + 0.013 * (1 - (u - 0.55) / 0.45) : 0.0185),
        b * (0.152 - 0.012 * u)
      ])
    })), M.steel);
    head.add(fixed);
    // dent : prisme hexagonal effilé, axe x
    const tooth = (len, thick, wide) => {
      const gg = new T.CylinderGeometry(wide * 0.5, wide * 0.18, len, 6, 1);
      gg.rotateZ(-Math.PI / 2); gg.scale(1, thick / wide, 1);
      return gg;
    };
    const m = new T.Matrix4();
    const ft = new T.InstancedMesh(tooth(0.052, 0.016, 0.0074), M.steelPolished, 38);
    for (let i = 0; i < 38; i++) { m.makeTranslation(0.203, -0.001, (i - 18.5) * 0.0074); ft.setMatrixAt(i, m); }
    ft.instanceMatrix.needsUpdate = true; head.add(ft);
    // peigne mobile : oscille sur la largeur (axe local x du groupe pivoté)
    const cutter = new T.Group(); cutter.rotation.y = Math.PI / 2;
    const inner = new T.Group(); inner.rotation.y = -Math.PI / 2; cutter.add(inner);
    const cPlate = new T.Mesh(loft(T, 5, u => ({
      c: new T.Vector3(0.03 + 0.115 * u, 0.026, 0), ax: new T.Vector3(0, 1, 0), ay: new T.Vector3(0, 0, 1),
      pts: [[1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => [
        a * (u > 0.6 ? 0.004 + 0.0095 * (1 - (u - 0.6) / 0.4) : 0.0135),
        b * (0.124 - 0.008 * u)
      ])
    })), M.steelDark);
    inner.add(cPlate);
    const ct = new T.InstancedMesh(tooth(0.04, 0.013, 0.0086), M.steel, 27);
    for (let i = 0; i < 27; i++) { m.makeTranslation(0.164, 0.026, (i - 13) * 0.0086); ct.setMatrixAt(i, m); }
    ct.instanceMatrix.needsUpdate = true; inner.add(ct);
    head.add(cutter);
    g.userData.moving = [cutter];
    // pont-ressort acier et deux vis de lame à tête fendue
    const bridge = new T.Mesh(new T.BoxGeometry(0.07, 0.006, 0.17), M.steelPolished);
    bridge.position.set(0.035, 0.044, 0); head.add(bridge);
    for (const z of [-0.062, 0.062]) {
      const sc = new T.Mesh(new T.CylinderGeometry(0.013, 0.013, 0.008, 24), M.steelPolished);
      sc.position.set(0.026, 0.05, z); head.add(sc);
      const slot = new T.Mesh(new T.BoxGeometry(0.02, 0.003, 0.004), M.steelDark);
      slot.position.set(0.026, 0.054, z); head.add(slot);
    }
    g.add(head);

    /* levier de dégradé : pivot, bras plat, poucier strié, crans */
    const lever = new T.Group();
    lever.position.set(0.155, 0.01, -(halfW(0.155) + 0.004));
    const track = new T.Mesh(new T.BoxGeometry(0.03, 0.15, 0.006), M.steelDark);
    track.position.set(0, -0.055, 0); lever.add(track);
    for (let i = 0; i < 5; i++) {
      const notch = new T.Mesh(new T.BoxGeometry(0.026, 0.004, 0.01), M.steelPolished);
      notch.position.set(0, -0.012 - i * 0.026, 0.001); lever.add(notch);
    }
    const arm = new T.Group(); arm.rotation.z = 0.26; lever.add(arm);
    const armM = new T.Mesh(new T.BoxGeometry(0.022, 0.125, 0.009), M.steel);
    armM.position.set(0, -0.058, 0.008); arm.add(armM);
    const thumb = new T.Mesh(new T.BoxGeometry(0.042, 0.03, 0.014), M.rubber);
    thumb.position.set(0, -0.122, 0.01); arm.add(thumb);
    for (let i = 0; i < 3; i++) {
      const rb = new T.Mesh(new T.BoxGeometry(0.038, 0.004, 0.004), M.steelDark);
      rb.position.set(0, -0.13 + i * 0.008, 0.018); arm.add(rb);
    }
    const pivot = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.014, 24), M.steelPolished);
    pivot.rotation.x = Math.PI / 2; pivot.position.set(0, 0, 0.006); lever.add(pivot);
    g.add(lever);
    return g;
  }

  /* peigne de coiffeur : dos fuselé, dents fines d'un côté, larges de l'autre, en capsules */
  function makeComb(T, M) {
    const g = new T.Group();
    const L = 0.9, H0 = 0.078, H1 = 0.06, r = 0.02;
    const s = new T.Shape();
    s.moveTo(-L / 2 + r, 0);
    s.lineTo(L / 2 - r, 0); s.quadraticCurveTo(L / 2, 0, L / 2, r);
    s.lineTo(L / 2, H1 - r); s.quadraticCurveTo(L / 2, H1, L / 2 - r, H1);
    s.lineTo(-L / 2 + r, H0); s.quadraticCurveTo(-L / 2, H0, -L / 2, H0 - r);
    s.lineTo(-L / 2, r); s.quadraticCurveTo(-L / 2, 0, -L / 2 + r, 0);
    g.add(new T.Mesh(ext(T, s, 0.03, 16), M.acetate));
    const m = new T.Matrix4();
    const fine = new T.InstancedMesh(new T.CapsuleGeometry(0.0042, 0.105, 3, 8), M.acetate, 22);
    for (let i = 0; i < 22; i++) { m.makeTranslation(-L / 2 + 0.035 + i * 0.0182, -0.05, 0.015); fine.setMatrixAt(i, m); }
    fine.instanceMatrix.needsUpdate = true; g.add(fine);
    const coarse = new T.InstancedMesh(new T.CapsuleGeometry(0.0058, 0.112, 3, 8), M.acetate, 12);
    for (let i = 0; i < 12; i++) { m.makeTranslation(0.035 + i * 0.0345, -0.054, 0.015); coarse.setMatrixAt(i, m); }
    coarse.instanceMatrix.needsUpdate = true; g.add(coarse);
    return g;
  }

  function shadowPool(T) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.34)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    const tex = new T.CanvasTexture(c);
    if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(1, 1),
      new T.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.35, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  /* ---------- post-traitement ---------- */

  const POST_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  /* Passe de post-traitement. Ordre critique : le tone mapping ACES et l'encodage sRGB
     sont appliqués à CHAQUE échantillon (tap) avant l'antialiasing. Auparavant le FXAA
     comparait des luminances HDR linéaires, où un reflet spéculaire vaut plusieurs unités :
     le seuil était franchi partout, les taps s'étalaient sur 8 px et les arêtes fines
     (dents de lame, fil des ciseaux) ressortaient crénelées après tone mapping. */
  const POST_FRAG = [
    'uniform sampler2D tDiffuse; uniform float uAmount; uniform float uTime; uniform float uFade; uniform vec2 uRes; uniform float uFxaa;',
    'varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
    'float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }',
    // three injecte déjà toneMapping() et linearToOutputTexel() dans ce programme :
    // on les applique par échantillon, donc en amont de l'antialiasing
    'vec4 tap(vec2 uv){ vec4 t = texture2D(tDiffuse, uv); return vec4(linearToOutputTexel(vec4(toneMapping(t.rgb), 1.0)).rgb, t.a); }',
    'vec4 aa(vec2 uv){',
    '  vec4 M = tap(uv);',
    '  if (uFxaa < 0.5) return M;',
    '  vec2 px = 1.0 / uRes;',
    '  vec3 NW = tap(uv + vec2(-1.0, -1.0) * px).rgb;',
    '  vec3 NE = tap(uv + vec2( 1.0, -1.0) * px).rgb;',
    '  vec3 SW = tap(uv + vec2(-1.0,  1.0) * px).rgb;',
    '  vec3 SE = tap(uv + vec2( 1.0,  1.0) * px).rgb;',
    '  float lNW = lum(NW), lNE = lum(NE), lSW = lum(SW), lSE = lum(SE), lM = lum(M.rgb);',
    '  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));',
    '  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));',
    // seuil en espace d'affichage : les vraies arêtes seules sont traitées
    '  if (lMax - lMin < max(0.035, lMax * 0.16)) return M;',
    '  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));',
    '  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);',
    '  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);',
    // portée courte (2,5 px) : adoucit la marche d'escalier sans étaler les détails fins
    '  dir = clamp(dir * rcp, vec2(-2.5), vec2(2.5)) * px;',
    '  vec4 A = 0.5 * (tap(uv + dir * (1.0 / 3.0 - 0.5)) + tap(uv + dir * (2.0 / 3.0 - 0.5)));',
    '  vec4 B = A * 0.5 + 0.25 * (tap(uv - dir * 0.5) + tap(uv + dir * 0.5));',
    '  float lB = lum(B.rgb);',
    '  return (lB < lMin || lB > lMax) ? A : B;',
    '}',
    'void main(){',
    '  vec2 d = vUv - 0.5; float r2 = dot(d, d);',
    '  vec2 off = d * uAmount * (0.5 + 3.0 * r2);',
    '  vec4 c = aa(vUv);',
    // l'aberration ne se déclenche qu'au-delà de 1,2 px de décalage : au repos, aucune frange
    '  bool split = length(off * uRes) > 1.2;',
    '  vec4 cr = split ? aa(vUv + off) : c;',
    '  vec4 cb = split ? aa(vUv - off) : c;',
    '  float a = max(c.a, max(cr.a, cb.a));',
    '  vec3 col = vec3(cr.r, c.g, cb.b);',
    '  col *= 1.0 - 0.26 * smoothstep(0.1, 0.62, r2);',
    '  float n = hash(vUv * uRes);',
    '  col += (n - 0.5) * 0.012 * a;',
    '  gl_FragColor = vec4(col * a, a) * uFade;',
    '}'
  ].join('\n');

  /* ---------- élément ---------- */

  class BarberScene extends HTMLElement {
    connectedCallback() {
      if (this._boot) return;
      this._boot = true;
      this.setAttribute('aria-hidden', 'true');
      this.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;display:block;overflow:hidden';
      this._reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this._t = 0; this._tt = 0; this._mx = 0; this._my = 0; this._mxt = 0; this._myt = 0;
      this._raf = 0; this._lost = false; this._scroller = null; this._secN = 0;
      this._frameB = this._frame.bind(this);
      this._loader();

      this._onScrollProbe = e => {
        const t = e.target;
        if (t && t.nodeType === 1 && t !== document.documentElement && t !== document.body &&
            t.scrollHeight - t.clientHeight > 8) this._scroller = t;
      };
      window.addEventListener('scroll', this._onScrollProbe, { capture: true, passive: true });

      this._onVis = () => { if (document.hidden) this._stop(); else this._run(); };
      document.addEventListener('visibilitychange', this._onVis);

      if (!this._webgl()) { this._fail(); return; }
      loadThree().then(T => { if (this.isConnected && this._boot) this._build(T); })
        .catch(e => { console.warn('[barber-scene]', e); this._fail(); });
    }

    disconnectedCallback() { this._teardown(); }

    _webgl() {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch (e) { return false; }
    }

    _loader() {
      const w = document.createElement('div');
      w.style.cssText = 'position:absolute;top:64%;right:8vw;transform:translateY(-50%);width:min(180px,34vw);height:1px;background:rgba(237,231,222,0.14);transition:opacity .4s ease';
      const f = document.createElement('div');
      f.style.cssText = 'height:1px;width:0%;background:#EDE7DE';
      w.appendChild(f);
      this.appendChild(w);
      this._ld = w;
      const t0 = performance.now();
      const tick = () => {
        if (!this._ld) return;
        const t = clamp01((performance.now() - t0) / 1400);
        f.style.width = (out3(t) * 92).toFixed(1) + '%';
        this._ldRaf = requestAnimationFrame(tick);
      };
      tick();
    }

    _dropLoader() {
      if (this._ldRaf) cancelAnimationFrame(this._ldRaf);
      const w = this._ld; this._ld = null;
      if (!w) return;
      const f = w.firstChild; if (f) f.style.width = '100%';
      w.style.opacity = '0';
      setTimeout(() => w.remove(), 420);
    }

    _fail() { this._dropLoader(); this.dataset.state = 'indisponible'; }

    _build(T) {
      this.T = T;
      const V = (x, y, z) => new T.Vector3(x, y, z);
      this._mw = new T.Matrix4();
      const renderer = new T.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      // filtrage anisotrope : toute texture créée ensuite naît au niveau maximal du GPU
      this._maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;
      if ('DEFAULT_ANISOTROPY' in T.Texture) T.Texture.DEFAULT_ANISOTROPY = this._maxAniso;
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      // palier de qualité : fixé dans _fit(), quand la taille réelle de l'élément est connue
      this._tier = 2;
      renderer.shadowMap.enabled = false;
      if (T.SRGBColorSpace) renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer = renderer;

      const cv = renderer.domElement;
      cv.setAttribute('aria-hidden', 'true');
      cv.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none';
      this.appendChild(cv);
      cv.addEventListener('webglcontextlost', e => { e.preventDefault(); this._lost = true; this._lostAt = performance.now(); });
      cv.addEventListener('webglcontextrestored', () => { this._lost = false; });

      const scene = this.scene = new T.Scene();
      scene.fog = new T.FogExp2(0x0c0a09, 0.07);
      const cam = this.cam = new T.PerspectiveCamera(32, 1, 0.12, 40);
      scene.add(cam);

      /* environnement : lightformers rendus localement */
      const pmrem = new T.PMREMGenerator(renderer);
      const envScene = new T.Scene();
      envScene.background = new T.Color(0x8a7c68);
      const lf = (hex, i, pos, rot, w, h) => {
        const mat = new T.MeshBasicMaterial({ color: hex, side: T.DoubleSide });
        mat.color.multiplyScalar(0.3 * i + 0.55);
        const m = new T.Mesh(new T.PlaneGeometry(w, h), mat);
        m.position.set(pos[0], pos[1], pos[2]);
        m.rotation.set(rot[0], rot[1], rot[2]);
        envScene.add(m);
      };
      lf(0xfff2e0, 5.4, [0, 6.2, 0.5], [Math.PI / 2, 0, 0], 12, 5);
      lf(0xfff4e6, 2.9, [0, 3.4, 5.6], [-0.95, 0, 0], 15, 8);
      lf(0xfff4e6, 3.1, [0, 1.0, 9.5], [0, 0, 0], 18, 12);
      lf(0xffffff, 9.5, [-3.6, 4.4, 2.2], [Math.PI / 2, 0, 0.5], 0.7, 9);
      lf(0xffffff, 7.0, [2.2, 4.6, -0.6], [Math.PI / 2, 0, -0.35], 0.5, 8);
      lf(0xffd9a8, 5.2, [4.2, 2.6, -1.4], [0, -1.1, 0.35], 0.8, 7);
      lf(0xb8d2ff, 1.9, [0, 1.1, -7], [0, 0, 0], 16, 3.6);
      lf(0xffb060, 3.4, [6.8, 0.5, 1.6], [0, -Math.PI / 2, 0], 5, 5);
      lf(0x9dbcff, 1.4, [-6.8, 0.8, 0.6], [0, Math.PI / 2, 0], 4.4, 4.4);
      lf(0x4a3b2d, 1.6, [0, -5, 0], [-Math.PI / 2, 0, 0], 16, 16);
      // enveloppe côté caméra : sans elle, toute face détournée des sources reste noire
      lf(0xf0e2cf, 1.15, [0, 1.4, 6.5], [0, 0, 0], 14, 10);
      lf(0xd8c9b4, 0.9, [0, -1.2, 3.2], [-0.5, 0, 0], 12, 7);
      this.envTex = pmrem.fromScene(envScene, 0.04).texture;
      scene.environment = this.envTex;
      this._envRot = 'environmentRotation' in scene ? scene.environmentRotation : null;
      envScene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      pmrem.dispose();

      scene.add(new T.AmbientLight(0xffe6c8, 0.26));
      const key = this.key = new T.DirectionalLight(0xffd9a8, 1.6); key.position.set(2.6, 4, 4); scene.add(key);
      const fill = new T.DirectionalLight(0xfff1dc, 0.75); fill.position.set(-2, 1.5, 5); scene.add(fill);
      const rim = this.rim = new T.DirectionalLight(0xc3d4e6, 0.7); rim.position.set(-3, 1.2, -3); scene.add(rim);
      // lampe d'atelier au-dessus de la station : ombrage doux sur la table
      const lamp = this.lamp = new T.SpotLight(0xffd2a0, 14, 11, 0.55, 1, 1.5); lamp.position.set(0.6, 4.0, 1.0); lamp.target.position.set(0, -0.9, -0.4);
      scene.add(lamp); scene.add(lamp.target);

      const maxA = this._maxAniso;
      const brushed = this._brushed = filterTex(brushedTex(T), T, maxA);
      const bnorm = this._bnorm = filterTex(brushedNormal(T), T, maxA);
      const fleck = this._fleck = fleckTex(T);
      const DS = T.FrontSide;
      const NS = new T.Vector2(0.1, 0.1);
      const steel = new T.MeshPhysicalMaterial({ color: 0xa9aeb4, metalness: 1, roughness: 0.46, roughnessMap: brushed, envMapIntensity: 1.45, side: DS });
      if ('anisotropy' in steel) { steel.anisotropy = 0.9; steel.anisotropyRotation = 0; }
      const steelPolished = new T.MeshPhysicalMaterial({ color: 0xbcc2c8, metalness: 1, roughness: 0.5, roughnessMap: brushed, envMapIntensity: 1.6, side: DS });
      if ('anisotropy' in steelPolished) steelPolished.anisotropy = 0.6;
      
      const M = {
        steel,
        steelPolished,
        steelDark: new T.MeshPhysicalMaterial({ color: 0x4a5057, metalness: 1, roughness: 0.42, envMapIntensity: 1.3, side: DS }),
        brass: new T.MeshPhysicalMaterial({ color: 0xb08a38, metalness: 1, roughness: 0.3, roughnessMap: brushed, envMapIntensity: 1.3 }),
        rubber: new T.MeshPhysicalMaterial({ color: 0x141210, metalness: 0, roughness: 0.95, sheen: 0.4, sheenRoughness: 0.9, sheenColor: new T.Color(0x3a322c), envMapIntensity: 0.5, side: DS }),
        resin: new T.MeshPhysicalMaterial({ color: 0x0c0a09, metalness: 0, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 2.0, side: DS }),
        resinFleck: new T.MeshPhysicalMaterial({ map: fleck, metalness: 0.15, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 2.2, side: DS }),
        acetate: new T.MeshPhysicalMaterial({ color: 0x2a1c14, metalness: 0, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.2, transmission: 0.12, thickness: 0.05, ior: 1.5, envMapIntensity: 2.0, side: DS })
      };
      this.mats = M;

      const root = this.root = new T.Group();
      scene.add(root);
      // table de travail : laque sombre, reflets d'environnement discrets, fondue dans le brouillard
      // sol : laque sombre à perte de vue, fondu dans le brouillard
      const floor = new T.Mesh(new T.PlaneGeometry(26, 26), new T.MeshPhysicalMaterial({ color: 0x080706, metalness: 0, roughness: 0.92, clearcoat: 0, specularIntensity: 0.2, envMapIntensity: 0.12 }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(0, -1.42, -1.5); root.add(floor);
      // plan de travail en marbre : c'est lui qui porte les outils
      this._marble = marbleTex(T);
      const top = new T.Mesh(new T.BoxGeometry(5.2, 0.19, 3.1), new T.MeshPhysicalMaterial({
        map: this._marble, roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.14, envMapIntensity: 0.35
      }));
      top.position.set(0.05, -1.015, -0.85); root.add(top);

      // caisson sous le plan, noyé dans l'ombre
      const base = new T.Mesh(new T.BoxGeometry(4.7, 1.3, 2.7), new T.MeshPhysicalMaterial({ color: 0x0d0b0a, roughness: 0.6, metalness: 0, clearcoat: 0.2, envMapIntensity: 0.15 }));
      base.position.set(0.05, -1.78, -0.9); root.add(base);
      // mur du fond
      this._wall = wallTex(T);
      const wall = new T.Mesh(new T.PlaneGeometry(18, 8), new T.MeshStandardMaterial({ map: this._wall, roughness: 0.95, metalness: 0, envMapIntensity: 0.2 }));
      wall.position.set(0, 1.6, -3.6); root.add(wall);
      // tapis de barbier en cuir, coutures, bord arrondi
      this._leather = leatherTex(T); this._leatherR = leatherRough(T);
      this._fade = fadeMask(T);
      const matG = new T.ExtrudeGeometry((() => { const sh = new T.Shape(); const w = 2.3, h = 1.25, r = 0.1;
        sh.moveTo(-w + r, -h); sh.lineTo(w - r, -h); sh.quadraticCurveTo(w, -h, w, -h + r); sh.lineTo(w, h - r); sh.quadraticCurveTo(w, h, w - r, h);
        sh.lineTo(-w + r, h); sh.quadraticCurveTo(-w, h, -w, h - r); sh.lineTo(-w, -h + r); sh.quadraticCurveTo(-w, -h, -w + r, -h); return sh; })(),
        { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 12 });
      // uv planaires pour la texture cuir
      { const p = matG.attributes.position, uv = new Float32Array(p.count * 2);
        for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) / 4.6) + 0.5; uv[i * 2 + 1] = (p.getY(i) / 2.5) + 0.5; }
        matG.setAttribute('uv', new T.BufferAttribute(uv, 2)); }
      const table = new T.Mesh(matG, new T.MeshPhysicalMaterial({ map: this._leather, roughnessMap: this._leatherR, alphaMap: this._fade, transparent: true, depthWrite: true, alphaTest: 0.02, roughness: 0.88, metalness: 0, sheen: 0.14, sheenRoughness: 0.9, sheenColor: new T.Color(0x241a14), clearcoat: 0.04, clearcoatRoughness: 0.75, envMapIntensity: 0.22 }));
      table.rotation.x = -Math.PI / 2; table.position.set(0.05, -0.913, -0.75); root.add(table);
      this.glowWarm = glowPlane(T, '255,166,84', 0.4);
      this.glowWarm.position.set(0.6, 0.5, -4.6);
      root.add(this.glowWarm);

      /* Miroirs verticaux rétroéclairés : le verre renvoie l'environnement (métal noir très poli),
         le halo derrière donne la ligne lumineuse caractéristique du salon. */
      const mirrorGlass = new T.MeshPhysicalMaterial({ color: 0x14171a, metalness: 1, roughness: 0.3, envMapIntensity: 1.7 });
      const mirrorFrame = new T.MeshPhysicalMaterial({ color: 0x0a0908, metalness: 0.2, roughness: 0.45, envMapIntensity: 0.5 });
      this.mirrorGlow = [];
      for (const mx of [-1.62, 1.58]) {
        const g = new T.Group();
        g.position.set(mx, 0.62, -3.42);
        const W = 0.78, H = 2.05;
        const glass = new T.Mesh(new T.PlaneGeometry(W, H), mirrorGlass);
        g.add(glass);
        const bar = (w, h, x, y) => { const b = new T.Mesh(new T.BoxGeometry(w, h, 0.05), mirrorFrame); b.position.set(x, y, -0.03); g.add(b); };
        bar(W + 0.07, 0.035, 0, H / 2 + 0.017);
        bar(W + 0.07, 0.035, 0, -H / 2 - 0.017);
        bar(0.035, H + 0.07, -W / 2 - 0.017, 0);
        bar(0.035, H + 0.07, W / 2 + 0.017, 0);
        const halo = glowPlane(T, '255,236,206', 0.85);
        halo.scale.set(W * 2.6, H * 1.45, 1);
        halo.position.set(0, 0, -0.08);
        g.add(halo);
        this.mirrorGlow.push(halo.material);
        root.add(g);
      }

      const tools = this.toolsRoot = new T.Group();
      root.add(tools);

      const scissors = makeScissors(T, M);
      const razor = makeRazor(T, M);
      const clipper = makeClipper(T, M);
      const comb = makeComb(T, M);
      this.scissors = scissors; this.razor = razor; this.clipper = clipper; this.comb = comb;

      // home : posé sur la table ; lift : présenté à la caméra ; liftKeys : par étape 0..4
      const D = (o, scale, home, lift, liftKeys, ph, delay, from, pool) => {
        Object.assign(o.userData, {
          home: { pos: V(...home[0]), rot: V(...home[1]) },
          lift: { pos: V(...lift[0]), rot: V(...lift[1]) },
          liftKeys, ph, delay, from: V(...from), poolScale: pool
        });
        o.scale.setScalar(scale);

        tools.add(o);
        o.userData.pool = null;
      };
      D(scissors, 1.12, [[-1.55, -0.82, -0.75], [-Math.PI / 2, 0, 0.95]], [[-1.3, 0.1, -0.4], [0.4, -0.5, -0.95]], [0, 0, 1, 0, 0], 3.4, 260, [-0.3, -0.5, 0], 3.4);
      D(razor, 1.0, [[1.75, -0.835, -0.8], [-Math.PI / 2, 0, 0.52]], [[1.35, 0.05, -0.45], [0.22, 0.28, 0.5]], [0, 0, 0, 1, 0], 1.7, 140, [0.25, -0.45, 0], 2.4);
      D(clipper, 1.3, [[0.05, -0.795, 0.1], [-Math.PI / 2, 0, -0.32]], [[-0.1, 0.1, 0.1], [0.3, -0.75, -0.15]], [1, 1, 0, 0, 0], 0, 0, [0, 1.6, 0], 2.0);
      // la tondeuse entre debout, tête en haut, en tournant sur son axe pendant la descente
      clipper.userData.spinDown = { turns: 2.4 };
      D(comb, 0.85, [[0.5, -0.88, -1.25], [-Math.PI / 2, 0, 0.18]], [[0.5, -0.5, -1.25], [-1.1, 0, 0.18]], [0, 0, 0, 0, 0], 5.1, 380, [0.15, -0.4, 0], 1.8);
      this.tools = [scissors, razor, clipper, comb];

      /* Les hauteurs ne sont plus devinées : chaque outil est mesuré dans sa pose,
         puis posé exactement sur le marbre (et dégagé de lui en pose vedette). */
      // hauteur d'appui lue sur la géométrie : tapis de cuir là où il est, marbre ailleurs
      const matBox = this._matBox = new T.Box3().setFromObject(table);
      const slabBox = this._slabBox = new T.Box3().setFromObject(top);
      const supportAt = this._supportAt = (x, z) => (x >= matBox.min.x && x <= matBox.max.x && z >= matBox.min.z && z <= matBox.max.z)
        ? matBox.max.y : slabBox.max.y;
      {
        // vrai point le plus bas (une Box3 tournée est trop généreuse et fait léviter l'objet)
        const v = new T.Vector3();
        const lowest = o => {
          let m = Infinity;
          o.updateMatrixWorld(true);
          o.traverse(n => {
            if (!n.isMesh || !n.geometry || !n.geometry.attributes.position) return;
            const p = n.geometry.attributes.position;
            if (n.isInstancedMesh) { const b = new T.Box3().setFromObject(n); if (b.min.y < m) m = b.min.y; return; }
            for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld); if (v.y < m) m = v.y; }
          });
          return m;
        };
        // sommets extrêmes dans 122 directions : cette enveloppe suffit à connaître le point le plus bas
        const DIRS = (() => {
          const n = 122, d = [];
          for (let i = 0; i < n; i++) {
            const y = 1 - (i / (n - 1)) * 2;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const th = i * 2.399963229728653;
            d.push(new T.Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
          }
          return d;
        })();
        // enveloppe d'un nœud, exprimée dans SON repère, en sautant les sous-arbres listés
        const hullOf = (node, skip) => {
          node.updateMatrixWorld(true);
          const inv = new T.Matrix4().copy(node.matrixWorld).invert();
          const best = new Float64Array(DIRS.length).fill(-Infinity);
          const pts = new Array(DIRS.length).fill(null);
          const m = new T.Matrix4();
          const consider = q => {
            for (let d = 0; d < DIRS.length; d++) {
              const sc = q.x * DIRS[d].x + q.y * DIRS[d].y + q.z * DIRS[d].z;
              if (sc > best[d]) { best[d] = sc; pts[d] = q.clone(); }
            }
          };
          const walk = n => {
            if (skip && skip.indexOf(n) >= 0) return;
            if (n.isMesh && n.geometry && n.geometry.attributes.position) {
              if (n.isInstancedMesh) {
                const b = new T.Box3().setFromObject(n);
                for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) {
                  consider(new T.Vector3(cx, cy, cz).applyMatrix4(inv));
                }
              } else {
                m.multiplyMatrices(inv, n.matrixWorld);
                const p = n.geometry.attributes.position;
                const step = p.count > 6000 ? 2 : 1;
                for (let i = 0; i < p.count; i += step) consider(v.fromBufferAttribute(p, i).applyMatrix4(m));
              }
            }
            for (const ch of n.children) walk(ch);
          };
          walk(node);
          const out = [];
          for (const q of pts) if (q && !out.some(r => r.distanceToSquared(q) < 1e-8)) out.push(q);
          return out;
        };

        /* Une enveloppe par pièce articulée (lames, manche, tête de coupe) plus une pour
           le reste immobile : la bride voit ainsi la pose réellement rendue. */
        const clampSets = o => {
          const u = o.userData;
          const moving = [];
          if (u.halves) moving.push(...u.halves);
          if (u.handle) moving.push(u.handle);
          if (u.moving) moving.push(...u.moving);
          const sets = [{ node: o, pts: hullOf(o, moving) }];
          for (const n of moving) sets.push({ node: n, pts: hullOf(n, null) });
          return sets.filter(x => x.pts.length);
        };
        const hull = o => hullOf(o, null);
        const bb = new T.Box3();
        for (const o of this.tools) {
          const u = o.userData;
          o.position.set(u.home.pos.x, 0, u.home.pos.z);
          o.rotation.set(u.home.rot.x, u.home.rot.y, u.home.rot.z);
          tools.updateMatrixWorld(true);
          // marge pour le léger basculement au repos : proportionnelle à l'encombrement
          bb.setFromObject(o);
          const sh = supportAt(u.home.pos.x, u.home.pos.z);
          u.home.pos.y = sh + 0.004 - lowest(o);
          o.position.set(u.lift.pos.x, 0, u.lift.pos.z);
          o.rotation.set(u.lift.rot.x, u.lift.rot.y, u.lift.rot.z);
          tools.updateMatrixWorld(true);
          u.lift.pos.y = supportAt(u.lift.pos.x, u.lift.pos.z) + 0.2 - lowest(o);

          /* Nuage de sommets extrêmes, dans le repère de l'outil : il borne le point le plus bas
             quelle que soit la pose, donc aussi sous le lacet qui tourne avec le temps. */
          u.clampSets = clampSets(o);
        }
      }

      // gabarit de cadrage : les ciseaux en pose vedette (échelle du voyage inchangée)
      scissors.position.copy(scissors.userData.lift.pos);
      scissors.rotation.set(0.4, -0.5, -0.95);
      tools.updateMatrixWorld(true);
      this._scisH = new T.Box3().setFromObject(scissors).getSize(new T.Vector3()).y;

      // points d'étape caméra : cible + direction (unité ≈ 3.3) ; shift = cible décalée vers la droite
      const L = o => o.userData.lift.pos;
      this.WP = [
        { tgt: () => L(clipper).clone(), dir: [0.95, 0.5, 3.05], shift: 1 },
        { tgt: () => L(clipper).clone().add(V(0.06, 0.02, 0)), dir: [0.55, 0.32, 1.75], shift: 0.8 },
        { tgt: () => L(scissors).clone().add(V(0, 0.04, 0)), dir: [0.5, 0.42, 1.75], shift: 1 },
        { tgt: () => L(razor).clone(), dir: [-0.55, 0.42, 2.45], shift: 1 },
        { tgt: () => V(0.05, -0.78, -0.5), dir: [0.3, 1.9, 2.45], shift: 0.3 }
      ];

      /* post : cible de rendu HDR + quad plein écran */
      this._applyAniso(this._maxAniso);
      const gl2 = renderer.capabilities.isWebGL2;
      const hf = gl2 && renderer.extensions.has('EXT_color_buffer_float');
      this._rtOpts = { type: hf ? T.HalfFloatType : T.UnsignedByteType, samples: gl2 ? 4 : 0, depthBuffer: true };
      this._gl2 = gl2;
      this.rt = new T.WebGLRenderTarget(4, 4, Object.assign({}, this._rtOpts));
      this.postCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.postScene = new T.Scene();
      this.postMat = new T.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: this.rt.texture }, uAmount: { value: 0 }, uTime: { value: 0 },
          uFade: { value: 0 }, uRes: { value: new T.Vector2(1, 1) }, uFxaa: { value: 1 }
        },
        vertexShader: POST_VERT, fragmentShader: POST_FRAG,
        transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false
      });
      const quad = new T.Mesh(new T.PlaneGeometry(2, 2), this.postMat);
      quad.frustumCulled = false;
      this.postScene.add(quad);

      this._onPointer = ev => {
        this._mxt = (ev.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
        this._myt = (ev.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      };
      if (matchMedia('(pointer: fine)').matches) {
        window.addEventListener('pointermove', this._onPointer, { passive: true });
      }

      this._mq = matchMedia('(max-width: 720px)');
      this._onMq = () => this._fit();
      if (this._mq.addEventListener) this._mq.addEventListener('change', this._onMq);
      else this._mq.addListener(this._onMq);
      this._ro = new ResizeObserver(() => { this._tops = null; this._fit(); });
      this._ro.observe(this);
      this._ro.observe(document.documentElement);
      if (document.body) this._ro.observe(document.body);
      this._onWinResize = () => this._fit();
      window.addEventListener('resize', this._onWinResize, { passive: true });
      window.addEventListener('load', this._onWinResize);
      this._fit();
      let k = 0;
      const settle = () => { this._fit(); if (k++ < 6) requestAnimationFrame(settle); };
      requestAnimationFrame(settle);
      let tries = 0;
      this._fitIv = setInterval(() => {
        const c = this.renderer && this.renderer.domElement;
        const ok = c && c.width > 1 && c.height > 1 && !this._needFit;
        if (ok || tries++ > 60) { clearInterval(this._fitIv); this._fitIv = 0; return; }
        this._fit();
      }, 200);

      this._t0 = 0;
      this._ready = false;
      const t0v = this._readT();
      this._tt = t0v == null ? 0 : t0v;
      this._t = this._tt;
      if (t0v != null) this._ready = true;
      this._dropLoader();
      this._run();
    }

    _fit() {
      const T = this.T; if (!T || !this.renderer) return;
      const r = this.getBoundingClientRect();
      const de = document.documentElement;
      const w = Math.round(r.width) || this.clientWidth || de.clientWidth || window.innerWidth || 0;
      const h = Math.round(r.height) || this.clientHeight || de.clientHeight || window.innerHeight || 0;
      if (w < 2 || h < 2) { this._needFit = true; return; }
      this._needFit = false;
      const narrow = this._narrow = this._mq ? this._mq.matches : w <= 720;
      if (!this._tierLocked) {
        const weak = narrow || w <= 720 || (navigator.hardwareConcurrency || 4) <= 4 || matchMedia('(pointer: coarse)').matches;
        this._setTier(weak ? 0 : 2);
      }
      // budget de pixels : dépend du palier de qualité (3,2 Mpx bureau, 1,3 Mpx mobile ou GPU lent)
      const budget = this._tier > 1 ? 2.0e6 : this._tier > 0 ? 1.3e6 : 0.85e6;
      const dev = window.devicePixelRatio || 1;
      let dpr = Math.min(dev, this._tier > 1 ? 2 : 1.25, Math.sqrt(budget / (w * h)));
      // un rapport fractionnaire force le compositeur à rééchantillonner le canvas :
      // flou, et crénelage réintroduit. On se cale sur le rapport écran, sinon sur un demi.
      dpr = dev - dpr < 0.34 ? dev : Math.max(1, Math.floor(dpr * 2) / 2);
      if (this.postMat) this.postMat.uniforms.uFxaa.value = this._tier > 0 ? 1 : 0;
      if (Math.abs((this._dpr || 0) - dpr) > 0.01) { this._dpr = dpr; this.renderer.setPixelRatio(dpr); }
      this.renderer.setSize(w, h, false);
      const pw = Math.max(1, Math.floor(w * dpr)), ph = Math.max(1, Math.floor(h * dpr));
      this.rt.setSize(pw, ph);
      this._acc = 0; this._n = 0;
      this.postMat.uniforms.uRes.value.set(pw, ph);

      const cam = this.cam;
      cam.fov = narrow ? 44 : 32;
      cam.aspect = w / Math.max(1, h);
      cam.updateProjectionMatrix();
      // les ciseaux en vedette occupent ~56 % de la hauteur ; tout le voyage est mis à cette échelle
      const visH = this._scisH / (narrow ? 0.62 : 0.74);
      const d0 = visH / (2 * Math.tan(T.MathUtils.degToRad(cam.fov) / 2));
      const k = this._k = d0 / 3.24;
      const P = [], Q = [];
      for (const wp of this.WP) {
        const tgt = wp.tgt();
        Q.push(tgt);
        P.push(tgt.clone().add(new T.Vector3(wp.dir[0], wp.dir[1], wp.dir[2]).multiplyScalar(k)));
      }
      this.camCurve = new T.CatmullRomCurve3(P, false, 'centripetal', 0.5);
      this.tgtCurve = new T.CatmullRomCurve3(Q, false, 'centripetal', 0.5);
      this._shiftKeys = this.WP.map(wp => wp.shift);
      const gs = visH * 1.35;
      this.glowWarm.scale.set(gs, gs, 1);
      this._glowOp = narrow ? 0.4 : 0.55;
      if (!this._raf) this._render(performance.now());
    }

    /* Filtrage anisotrope sur toutes les cartes de la scène : mipmaps + niveau demandé,
       ce qui supprime le scintillement des textures vues en biais (marbre, acier brossé,
       mur, miroirs) sans coût de rendu notable. */
    _applyAniso(level) {
      if (!this.scene) return;
      const T = this.T, seen = new Set();
      const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'clearcoatNormalMap', 'specularMap', 'sheenColorMap'];
      const lv = Math.max(1, Math.min(this._maxAniso || 1, level));
      this.scene.traverse(o => {
        const mats = !o.material ? [] : (Array.isArray(o.material) ? o.material : [o.material]);
        for (const mat of mats) for (const s of SLOTS) {
          const t = mat[s];
          if (!t || seen.has(t) || t.isCubeTexture) continue;
          seen.add(t);
          if (t.anisotropy === lv) continue;
          t.generateMipmaps = true;
          t.minFilter = T.LinearMipmapLinearFilter;
          t.magFilter = T.LinearFilter;
          t.anisotropy = lv;
          t.needsUpdate = true;
        }
      });
    }

    // applique un palier de qualité : ombres, antialiasing, résolution
    _setTier(n) {
      n = Math.max(0, Math.min(2, n));
      if (n === this._tier && this._tierApplied) return;
      this._tier = n; this._tierApplied = true;
      const T = this.T, r = this.renderer;
      r.shadowMap.enabled = false;
      const want = this._gl2 ? (n > 1 ? 4 : n > 0 ? 2 : 0) : 0;
      if (this.rt && this.rt.samples !== want) {
        const w = this.rt.width, h = this.rt.height;
        this.rt.dispose();
        this.rt = new T.WebGLRenderTarget(Math.max(4, w), Math.max(4, h), Object.assign({}, this._rtOpts, { samples: want }));
        if (this.postMat) this.postMat.uniforms.tDiffuse.value = this.rt.texture;
      }
      this._dpr = 0;
      // le filtrage anisotrope suit le palier : max en haut, 4 au milieu, 2 en veille
      this._applyAniso(n > 1 ? this._maxAniso : n > 0 ? 4 : 2);
      this._acc = 0; this._n = 0; this._slow = 0;
    }

    /* position de lecture : index de section + fraction, lus dans le DOM de la page ;
       null tant que la page n'est pas mise en page (tous les hauts à 0) */
    _pageScroller() {
      const t = this._scroller;
      return t && t.isConnected && t.scrollHeight - t.clientHeight > 8 ? t : null;
    }

    _scrollY() {
      const sc = this._pageScroller();
      return sc ? sc.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0);
    }

    // mesure hors boucle : une seule fois par changement de mise en page
    _measureSecs() {
      const secs = Array.from(document.querySelectorAll('[data-sec]'));
      this._measured = performance.now();
      if (!secs.length) { this._tops = null; return; }
      const base = this._scrollY();
      const tops = secs.map(el => el.getBoundingClientRect().top + base);
      this._tops = (tops.length > 1 && tops.every(v => Math.abs(v - base) < 1)) ? null : tops;
      this._vh = window.innerHeight || 800;
    }

    _readT() {
      if (!this._tops || performance.now() - (this._measured || 0) > 700) this._measureSecs();
      const tops = this._tops;
      if (!tops) return null;
      const y = this._scrollY();
      let i = 0;
      while (i < tops.length - 1 && tops[i + 1] - y <= 0) i++;
      const a = tops[i] - y;
      const b = i < tops.length - 1 ? tops[i + 1] - y : a + this._vh;
      const f = clamp01(-a / Math.max(1, b - a));
      return Math.min(4.4, i + f);
    }

    _run() {
      if (this._raf || !this.renderer || document.hidden) return;
      this._acc = 0; this._n = 0; this._slow = 0;
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._frameB);
    }

    _stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; }

    _frame(now) {
      this._raf = requestAnimationFrame(this._frameB);
      const dt = Math.min((now - this._last) / 1000, 0.1) || 0.016;
      this._last = now;
      if (this._lost) {
        if (now - this._lostAt > 2000) { this._stop(); this._teardown(); this._fail(); }
        return;
      }
      this._watch(dt);
      this._update(now, dt);
      this._render(now);
    }

    // surveille le temps d'image et descend d'un palier si la fluidité décroche
    _watch(dt) {
      if (this._tier <= 0 || this._skipWatch) return;
      if (dt > 0.05) { this._acc = 0; this._n = 0; return; } // à-coup (onglet en veille, chargement) : pas une mesure de GPU
      this._acc = (this._acc || 0) + dt; this._n = (this._n || 0) + 1;
      if (this._n < 120) return;
      const avg = this._acc / this._n;
      this._acc = 0; this._n = 0;
      if (avg > 0.02) {
        if ((this._slow = (this._slow || 0) + 1) < 3) return;
        this._slow = 0;
        this._tierLocked = true;
        this._setTier(this._tier - 1);
        this._fit();
      } else { this._slow = 0; if (avg < 0.0135) this._skipWatch = true; }
    }

    _update(now, dt) {
      const T = this.T;
      const red = this._reduced && document.documentElement.dataset.motion !== 'force';
      if (!this._t0) this._t0 = now;
      const ts = now / 1000;
      const el = (now - this._t0) / 1000;
      const introE = red ? 1 : outExpo(clamp01(el / 2.6));
      const fade = red ? 1 : outExpo(clamp01((el - 0.15) / 1.5));

      const rt = this._readT();
      // première mesure valide : on se cale dessus sans vol
      if (rt != null && !this._ready) { this._ready = true; this._t = rt; }
      const tt = rt == null ? this._t : rt;
      const prev = this._t;
      this._t = red ? tt : dampf(this._t, tt, 0.052, dt);
      const t = this._t;
      const vt = (t - prev) / Math.max(dt, 1e-3);

      /* caméra : spline entre les étapes, cible décalée vers la droite quand un outil est en vedette */
      const cam = this.cam;
      const s = clamp01(t / 4);
      const camP = this.camCurve.getPoint(s);
      const tgt = this.tgtCurve.getPoint(s);
      if (t > 4) camP.y += (t - 4) * 0.6 * this._k;
      if (!red) camP.add(new T.Vector3(0.35, 0.9, 2.6).multiplyScalar(this._k * (1 - introE)));
      cam.position.copy(camP);
      cam.lookAt(tgt);
      const shift = this._narrow ? 0 : keyLerp(this._shiftKeys, t) * 0.235;
      if (shift) {
        const right = new T.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
        const d = camP.distanceTo(tgt);
        const visW = 2 * d * Math.tan(T.MathUtils.degToRad(cam.fov) / 2) * cam.aspect;
        cam.lookAt(tgt.clone().addScaledVector(right, -shift * visW));
      }
      if (!red) {
        this._mx = dampf(this._mx, this._mxt, 0.03, dt);
        this._my = dampf(this._my, this._myt, 0.03, dt);
        cam.rotateY(-this._mx * 0.022);
        cam.rotateX(-this._my * 0.016);
      }

      /* outils : posés sur la table, ou présentés et flottants quand ils sont en vedette */
      let introMin = 1;
      for (const o of this.tools) {
        const u = o.userData;
        const it = red ? 1 : clamp01((el * 1000 - u.delay) / 1300);
        const intro = red ? 1 : backOut(it);
        if (it < introMin) introMin = it;
        const Lf = keyLerp(u.liftKeys, t);
        // vedette : flottement lent + rotation continue ; au repos : léger basculement sur le tapis
        const fy = red ? 0 : Lf * (Math.sin(ts * (2 * Math.PI / 17) + u.ph) * 0.022 + Math.sin(ts * (2 * Math.PI / 27) + u.ph * 1.7) * 0.008);
        const idle = red ? 0 : (1 - Lf);
        const dxz = idle * Math.sin(ts * (2 * Math.PI / 34) + u.ph) * 0.014;
        const spin = red ? 0 : Lf * ts * 0.018 + idle * Math.sin(ts * (2 * Math.PI / 46) + u.ph * 2.1) * 0.03;
        const ry = (red ? 0 : Lf * Math.sin(ts * (2 * Math.PI / 24) + u.ph) * 0.055) + spin;
        const tilt = Lf * Math.sin(ts * (2 * Math.PI / 40) + u.ph * 1.3) * 0.008;
        o.position.set(
          mix(u.home.pos.x, u.lift.pos.x, Lf) + dxz + (1 - intro) * u.from.x,
          mix(u.home.pos.y, u.lift.pos.y, Lf) + fy + (1 - intro) * u.from.y,
          mix(u.home.pos.z, u.lift.pos.z, Lf) + dxz * 0.6 + (1 - intro) * u.from.z
        );
        o.rotation.set(
          mix(u.home.rot.x, u.lift.rot.x, Lf) + tilt + (1 - intro) * 0.5,
          mix(u.home.rot.y, u.lift.rot.y, Lf) + ry + (1 - intro) * 0.7,
          mix(u.home.rot.z, u.lift.rot.z, Lf) + tilt * 0.7
        );
        // entrée debout : l'ordre XYZ applique Z en premier, donc Rz(+90°) dresse l'outil
        // (tête vers le haut) et Ry fait tourner le corps sur cet axe vertical
        if (u.spinDown && it < 1 && !red) {
          const k = Math.pow(1 - it, 1.45);
          o.rotation.set(
            mix(u.home.rot.x, u.lift.rot.x, Lf) * intro,
            mix(u.home.rot.y, u.lift.rot.y, Lf) * intro + k * u.spinDown.turns * Math.PI * 2,
            mix(mix(u.home.rot.z, u.lift.rot.z, Lf), Math.PI / 2, k)
          );
        }
        const p = u.pool;
        if (p) {
          p.position.x = o.position.x; p.position.z = o.position.z;
          p.material.opacity = 0.3 * (1 - Lf) * intro;
        }
      }
      const intro01 = red ? 1 : out3(introMin);

      /* actions d'outil, jouées pendant les vols */
      const halves = this.scissors.userData.halves;
      const breath = 0.07 + 0.045 * (0.5 + 0.5 * Math.sin(ts * 2 * Math.PI / 16));
      const r = keyLerp([0.06, 0.06, red ? 0.1 : breath, 0.018, 0.05], t) * intro01 + (red ? 0 : Math.sin(ts * 2 * Math.PI / 13) * 0.005);
      halves[0].rotation.z = r; halves[1].rotation.z = -r;
      this.razor.userData.handle.rotation.z = 0.349;
      const vib = red ? 0 : (keyLerp([1, 1, 0.12, 0.3, 0.2], t)) * Math.sin(ts * 2 * Math.PI * 3) * 0.005;
      this.clipper.userData.moving[0].position.x = vib;
      if (this.clipper.userData.led) this.clipper.userData.led.material.color.setHSL(0.08, 0.9, 0.42 + 0.22 * (0.5 + 0.5 * Math.sin(ts * 2 * Math.PI / 2.6)));

      /* Bride finale : la pose est complète (élévation, flottement, lames ouvertes, vibration),
         on remonte l'outil si son point le plus bas est passé sous son appui. */
      if (this._supportAt) {
        for (const o of this.tools) {
          const sets = o.userData.clampSets;
          if (!sets) continue;
          o.updateMatrixWorld(true);
          let minY = Infinity;
          for (const st of sets) {
            const e = st.node.matrixWorld.elements;
            for (const q of st.pts) {
              const wy = e[1] * q.x + e[5] * q.y + e[9] * q.z + e[13];
              if (wy < minY) minY = wy;
            }
          }
          const floorY = this._supportAt(o.position.x, o.position.z) + 0.003;
          if (minY < floorY) { o.position.y += floorY - minY; o.updateMatrixWorld(true); }
        }
      }

      /* reflets vivants */

      const breathe = red ? 0 : Math.sin(ts * 2 * Math.PI / 20) * 0.012;
      if (this.mirrorGlow) for (const m of this.mirrorGlow) m.opacity = 0.9 * intro01;
      this.glowWarm.material.opacity = this._glowOp * intro01 * (1 - 0.6 * sstep(3.2, 4, t));
      this.glowWarm.scale.setScalar(this.glowWarm.scale.x / (this._gw || 1) * (this._gw = 1 + breathe));

      /* post : aberration liée à la vitesse du vol, forte pendant l'intro */
      const U = this.postMat.uniforms;
      this._vtS = dampf(this._vtS || 0, Math.abs(vt), 0.08, dt);
      U.uAmount.value = red ? 0 : Math.min(0.0022, this._vtS * 0.0018) + 0.004 * (1 - introE);
      U.uTime.value = ts;
      U.uFade.value = fade;
    }

    _render(now) {
      const r = this.renderer;
      if (!r || !this.scene || !this.cam) return;
      r.setRenderTarget(this.rt);
      r.clear();
      r.render(this.scene, this.cam);
      r.setRenderTarget(null);
      r.render(this.postScene, this.postCam);
    }

    _teardown() {
      this._stop();
      if (this._fitIv) { clearInterval(this._fitIv); this._fitIv = 0; }
      if (this._onWinResize) {
        window.removeEventListener('resize', this._onWinResize);
        window.removeEventListener('load', this._onWinResize);
      }
      if (this._ldRaf) cancelAnimationFrame(this._ldRaf);
      window.removeEventListener('scroll', this._onScrollProbe, { capture: true });
      document.removeEventListener('visibilitychange', this._onVis);
      if (this._onPointer) window.removeEventListener('pointermove', this._onPointer);
      if (this._mq) {
        if (this._mq.removeEventListener) this._mq.removeEventListener('change', this._onMq);
        else this._mq.removeListener(this._onMq);
      }
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      if (this.scene) {
        this.scene.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); } }
        });
      }
      if (this.rt) this.rt.dispose();
      if (this.postMat) this.postMat.dispose();
      if (this.envTex) this.envTex.dispose();
      if (this._brushed) this._brushed.dispose();
      if (this._bnorm) this._bnorm.dispose();
      if (this._fleck) this._fleck.dispose();
      if (this._leather) this._leather.dispose();
      if (this._leatherR) this._leatherR.dispose();
      if (this._fade) this._fade.dispose();
      if (this._marble) this._marble.dispose();
      if (this._wall) this._wall.dispose();
      if (this.renderer) { this.renderer.dispose(); const c = this.renderer.domElement; if (c && c.parentNode) c.remove(); }
      this.renderer = null; this.scene = null; this.cam = null; this._boot = false;
    }
  }

  customElements.define('barber-scene', BarberScene);
})();
