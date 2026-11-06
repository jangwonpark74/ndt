import * as THREE from './vendor/three.module.js';

export function roofGeometry(rings, props, base, height, pointToLocal) {
  const type = typeof props.roof_shape === 'string' ? props.roof_shape.toLowerCase() : '';
  if (!['skillion', 'gabled', 'hipped', 'pyramidal', 'dome', 'onion', 'cone'].includes(type) || !rings.length || (rings.length > 1 && type !== 'skillion')) return null;
  const points = rings[0].filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(pointToLocal);
  if (points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points.pop();
  if (points.length < 3) return null;
  const holes = rings.slice(1).map(ring => {
    const hole = ring.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(pointToLocal);
    if (hole.length > 1 && hole[0][0] === hole.at(-1)[0] && hole[0][1] === hole.at(-1)[1]) hole.pop();
    return hole;
  });
  if (holes.some(hole => hole.length < 3)) return null;
  // The winding of the whole footprint determines which side of its edges is outside.
  // A skillion roof is one plane, so it also works for concave footprints.
  let signedArea = 0;
  const originPoint = points[0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    signedArea += (a[0] - originPoint[0]) * (b[1] - originPoint[1])
      - (a[1] - originPoint[1]) * (b[0] - originPoint[0]);
  }
  const sign = Math.sign(signedArea);
  if (!sign) return null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-8) continue;
    if (!['skillion', 'gabled'].includes(type) && sign * cross < 0) return null;
  }
  // Use the minimum-area bounding rectangle to infer the ridge when OSM has no direction.
  let frame = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!length) continue;
    const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], v = [-u[1], u[0]];
    const us = points.map(p => p[0] * u[0] + p[1] * u[1]), vs = points.map(p => p[0] * v[0] + p[1] * v[1]);
    const area = (Math.max(...us) - Math.min(...us)) * (Math.max(...vs) - Math.min(...vs));
    if (!frame || area < frame.area) frame = { u, v, us, vs, area };
  }
  if (!frame || frame.area < 1e-8) return null;
  if (Math.max(...frame.us) - Math.min(...frame.us) < Math.max(...frame.vs) - Math.min(...frame.vs)) {
    const old = frame.u; frame.u = frame.v; frame.v = [-old[0], -old[1]];
  }
  // roof:direction is the downhill direction, clockwise from geographic north.
  const directionText = String(props.roof_direction ?? '').trim().toUpperCase();
  const compass = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  let direction = compass.indexOf(directionText);
  direction = direction >= 0 ? direction * 22.5 : (directionText && Number.isFinite(Number(directionText)) ? Number(directionText) : null);
  if (direction !== null && direction >= 0 && direction <= 360) {
    const angle = direction * Math.PI / 180;
    frame.v = [Math.sin(angle), -Math.cos(angle)];
    frame.u = [-frame.v[1], frame.v[0]];
  } else if (props.roof_orientation === 'across' && type !== 'skillion') {
    const old = frame.u; frame.u = frame.v; frame.v = [-old[0], -old[1]];
  }
  const project = p => [p[0] * frame.u[0] + p[1] * frame.u[1], p[0] * frame.v[0] + p[1] * frame.v[1]];
  const uv = points.map(project), us = uv.map(p => p[0]), vs = uv.map(p => p[1]);
  const loU = Math.min(...us), hiU = Math.max(...us), loV = Math.min(...vs), hiV = Math.max(...vs);
  const width = hiV - loV, midV = (loV + hiV) / 2;
  if (width < 1e-6) return null;
  const available = height - base;
  const explicit = props.roof_height != null && props.roof_height !== '' ? Number(props.roof_height) : NaN;
  const levels = props.roof_levels != null && props.roof_levels !== '' ? Number(props.roof_levels) : NaN;
  const angle = props.roof_angle != null && props.roof_angle !== '' ? Number(props.roof_angle) : NaN;
  // Missing OSM roof heights are estimates; elevated dome parts can consist entirely of roof.
  let roofHeight = Number.isFinite(explicit) && explicit > 0 ? explicit
    : Number.isFinite(levels) && levels > 0 ? levels * 3
    : Number.isFinite(angle) && angle > 0 && angle < 89 ? Math.tan(angle * Math.PI / 180) * width * (type === 'skillion' ? 1 : 0.5)
    : ['dome', 'onion'].includes(type) && base > 0 ? available : Math.min(available * 0.35, Math.max(2, width * 0.22));
  roofHeight = Math.min(available, roofHeight);
  if (!(roofHeight > 0.001)) return null;
  const eaves = height - roofHeight;
  const triangles = [];
  const add = (a, b, c) => {
    const cross = (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
    if (Math.abs(cross) < 1e-9) return;
    if (cross < 0) [b, c] = [c, b];
    triangles.push(...a, ...b, ...c);
  };
  const triangulate = polygon => {
    if (polygon.length < 3) return;
    const faces = THREE.ShapeUtils.triangulateShape(polygon.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const f of faces) add(polygon[f[0]], polygon[f[1]], polygon[f[2]]);
  };
  let roofZ;
  if (type === 'skillion') {
    roofZ = p => height - roofHeight * (project(p)[1] - loV) / width;
    const vertices = [...points, ...holes.flat()];
    const faces = THREE.ShapeUtils.triangulateShape(points.map(p => new THREE.Vector2(...p)), holes.map(hole => hole.map(p => new THREE.Vector2(...p))));
    for (const face of faces) add(...face.map(index => [...vertices[index], roofZ(vertices[index])]));
  } else if (type === 'gabled') {
    roofZ = p => height - roofHeight * Math.abs(project(p)[1] - midV) / (width / 2);
    // Clip each footprint triangle separately: clipping a concave polygon as one
    // ring can connect disjoint pieces and create roofs outside the footprint.
    const faces = THREE.ShapeUtils.triangulateShape(points.map(p => new THREE.Vector2(...p)), []);
    for (const face of faces) for (const side of [-1, 1]) {
      const triangle = face.map(index => points[index]);
      const clipped = [];
      for (let i = 0; i < triangle.length; i++) {
        const a = triangle[i], b = triangle[(i + 1) % triangle.length];
        const da = side * (project(a)[1] - midV), db = side * (project(b)[1] - midV);
        if (da >= -1e-8) clipped.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const t = da / (da - db); clipped.push([a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1])]);
        }
      }
      triangulate(clipped.map(p => [p[0], p[1], roofZ(p)]));
    }
  } else if (type === 'hipped') {
    // A rectangular hip roof has two ridge endpoints; other footprints safely stay flat.
    if (points.length !== 4) return null;
    const corners = [[loU, loV], [hiU, loV], [hiU, hiV], [loU, hiV]];
    const chosen = corners.map(([u, v]) => {
      let best = 0, distance = Infinity;
      uv.forEach((q, i) => { const d = Math.hypot(q[0]-u, q[1]-v); if (d < distance) { best = i; distance = d; } });
      return { point: points[best], index: best, distance };
    });
    if (new Set(chosen.map(c => c.index)).size !== 4 || chosen.some(c => c.distance > Math.max(hiU-loU, width)*0.05)) return null;
    const p = chosen.map(c => [...c.point, eaves]);
    const fromUV = (u, v) => [u * frame.u[0] + v * frame.v[0], u * frame.u[1] + v * frame.v[1], height];
    const inset = Math.min(width / 2, (hiU-loU) / 2);
    const left = fromUV(loU + inset, midV), right = fromUV(hiU - inset, midV);
    add(p[0], p[1], right); add(p[0], right, left); add(p[1], p[2], right);
    add(p[2], p[3], left); add(p[2], left, right); add(p[3], p[0], left);
    roofZ = () => eaves;
  } else {
    const center = points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]);
    if (type === 'pyramidal' || type === 'cone') {
      for (let i = 0; i < points.length; i++) add([...points[i], eaves], [...points[(i+1)%points.length], eaves], [...center, height]);
    } else if (type === 'onion') {
      // A bounded illustrative onion profile follows the mapped footprint and height.
      const radii = [1, 0.88, 0.94, 0.8, 0.55, 0.25, 0];
      const ring = (p, step) => {
        const t = step / (radii.length - 1), radius = radii[step];
        return [center[0] + (p[0] - center[0]) * radius,
          center[1] + (p[1] - center[1]) * radius, eaves + roofHeight * t];
      };
      for (let j = 0; j < radii.length - 1; j++) {
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i + 1) % points.length];
          add(ring(a, j), ring(b, j), ring(a, j + 1));
          if (radii[j + 1] > 0) add(ring(b, j), ring(b, j + 1), ring(a, j + 1));
        }
      }
    } else {
      // The original polygon forms the dome perimeter; concentric rings add curvature.
      const steps = 12;
      const ring = (p, t) => [center[0]+(p[0]-center[0])*t, center[1]+(p[1]-center[1])*t, eaves+roofHeight*Math.sqrt(Math.max(0, 1-t*t))];
      for (let j = 0; j < steps; j++) {
        const outer = 1-j/steps, inner = 1-(j+1)/steps;
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i+1)%points.length];
          add(ring(a, outer), ring(b, outer), ring(a, inner));
          if (inner > 0) add(ring(b, outer), ring(b, inner), ring(a, inner));
        }
      }
    }
    roofZ = () => eaves;
  }
  if (!triangles.length) return null;
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(triangles, 3));
  roof.computeVertexNormals();
  const walls = [];
  for (const boundary of [points, ...holes]) for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i+1)%boundary.length];
    // Boundary walls rise to the sloped roof edge; gable ridge ends need midpoint vertices.
    const edge = [a];
    if (type === 'gabled') {
      const da = project(a)[1]-midV, db = project(b)[1]-midV;
      if (da*db < 0) { const t = da/(da-db); edge.push([a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])]); }
    }
    edge.push(b);
    for (let j = 0; j < edge.length-1; j++) {
      const p = edge[j], q = edge[j+1], pz = roofZ(p), qz = roofZ(q);
      if (Math.max(pz, qz) <= eaves + 1e-6) continue;
      const p0 = [p[0],p[1],eaves], q0 = [q[0],q[1],eaves], p1 = [p[0],p[1],pz], q1 = [q[0],q[1],qz];
      if (sign > 0) walls.push(...p0,...q0,...q1,...p0,...q1,...p1);
      else walls.push(...q0,...p0,...p1,...q0,...p1,...q1);
    }
  }
  const wall = new THREE.BufferGeometry();
  wall.setAttribute('position', new THREE.Float32BufferAttribute(walls, 3));
  wall.computeVertexNormals();
  return { roof, wall, eaves };
}
