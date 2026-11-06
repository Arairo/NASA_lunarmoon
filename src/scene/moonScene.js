// CesiumJS Moon scene: the Moon as the globe, Earth and Sun placed from the
// app's own ephemeris, lighting and shadows driven by the real Sun direction.
//
// Cesium's built-in sun, moon, sky box and atmosphere all assume an Earth-fixed
// frame, so on a Moon globe they would be in the wrong place. We switch them off
// and supply our own DirectionalLight, Earth model and Sun sprite.

import * as Cesium from 'cesium';
import * as Astronomy from 'astronomy-engine';
import { eqjToMoonFixed } from '../core/ephemeris.js';
import { DEG } from '../core/geo.js';

const MOON = Cesium.Ellipsoid.MOON;
// Cesium reads Ellipsoid.default while constructing the viewer, globe,
// tiling schemes and camera; it must be the Moon before any of that happens.
Cesium.Ellipsoid.default = MOON;

const EARTH_RADIUS_M = 6371000;
const SUN_SPRITE_DISTANCE_M = 4.0e8; // inside the far plane; direction is what matters

const DATA = `${import.meta.env.BASE_URL}data`;

// Camera flights are instant for people who ask the system to reduce motion.
const motionScale = () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1);

/** A plain Sun marker: a disk with a thin ring, no glow. */
function sunSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  g.arc(32, 32, 20, 0, Math.PI * 2);
  g.fillStyle = '#ffe9b0';
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#f2b630';
  g.stroke();
  return c;
}

/** Stitch Cesium's bundled Natural Earth II level-2 TMS tiles into one texture. */
async function earthTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const g = canvas.getContext('2d');
  g.fillStyle = '#1b3a6b';
  g.fillRect(0, 0, 2048, 1024);
  const jobs = [];
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 4; y++) {
      const url = Cesium.buildModuleUrl(`Assets/Textures/NaturalEarthII/2/${x}/${y}.jpg`);
      jobs.push(
        Cesium.Resource.fetchImage({ url })
          .then((img) => g.drawImage(img, x * 256, (3 - y) * 256, 256, 256)) // TMS rows count up from the south
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);
  return canvas;
}

/** Bundled LOLA south-pole relief as a Cesium terrain provider (works offline). */
function lolaTerrainProvider(terrain) {
  const size = 33;
  const tilingScheme = new Cesium.GeographicTilingScheme({ ellipsoid: MOON });
  return new Cesium.CustomHeightmapTerrainProvider({
    width: size,
    height: size,
    tilingScheme,
    credit: 'Terrain: LRO LOLA (NASA/GSFC), bundled south-pole grids',
    callback(x, y, level) {
      const rect = tilingScheme.tileXYToRectangle(x, y, level);
      const heights = new Float32Array(size * size);
      if (Cesium.Math.toDegrees(rect.north) < -74) {
        for (let r = 0; r < size; r++) {
          const lat = Cesium.Math.toDegrees(rect.north - ((rect.north - rect.south) * r) / (size - 1));
          for (let c = 0; c < size; c++) {
            const lon = Cesium.Math.toDegrees(rect.west + ((rect.east - rect.west) * c) / (size - 1));
            const h = terrain.heightAt(lat, lon);
            heights[r * size + c] = h ? h.height : 0;
          }
        }
      }
      return heights;
    },
  });
}

export async function createMoonScene(container, { terrain, onPick, onStatus }) {
  const status = (msg) => onStatus?.(msg);
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    skyAtmosphere: false,
    skyBox: false,
    shadows: true,
    terrainProvider: terrain ? lolaTerrainProvider(terrain) : undefined,
    // Render only when something changes (camera, tiles, time, entities) rather
    // than every frame: an idle globe then costs almost no CPU/GPU or battery.
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });
  const scene = viewer.scene;
  // With skyBox: false Cesium never creates its Earth-frame sun/moon; guard anyway.
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  scene.backgroundColor = Cesium.Color.BLACK;
  scene.globe.enableLighting = true;
  // Cesium fades lighting out near the surface (tuned for Earth). On the Moon
  // the Sun angle *is* the story, so keep it fully on at every distance.
  scene.globe.lightingFadeOutDistance = 0;
  scene.globe.lightingFadeInDistance = 1;
  scene.globe.showGroundAtmosphere = false;
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#4a4a4a');
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.shadows = Cesium.ShadowMode.ENABLED;
  scene.globe.maximumScreenSpaceError = 2; // Cesium default; ~40% fewer tiles than 1.5
  scene.fog.enabled = false;
  scene.highDynamicRange = false;
  scene.camera.frustum.far = 1.0e9;
  viewer.shadowMap.softShadows = false; // hard shadows are physically right without an atmosphere, and cheaper
  viewer.shadowMap.size = 2048;
  viewer.shadowMap.maximumDistance = 60000;
  viewer.shadowMap.darkness = 0.15; // no atmosphere: shadows are nearly black
  scene.screenSpaceCameraController.minimumZoomDistance = 30;

  const light = new Cesium.DirectionalLight({ direction: new Cesium.Cartesian3(1, 0, 0), intensity: 2.2 });
  scene.light = light;

  // Imagery: LROC WAC global mosaic + a 100 m-class polar drape.
  try {
    const global = await Cesium.SingleTileImageryProvider.fromUrl(`${DATA}/moon_wac_global_4k.jpg`, {
      rectangle: Cesium.Rectangle.MAX_VALUE,
      ellipsoid: MOON,
      credit: 'LROC WAC global mosaic (NASA/GSFC/ASU) via USGS Astrogeology',
    });
    viewer.imageryLayers.addImageryProvider(global);
    const polar = await Cesium.SingleTileImageryProvider.fromUrl(`${DATA}/sp_wac_geo.jpg`, {
      rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, -75),
      ellipsoid: MOON,
      credit: 'LROC WAC south polar mosaic (NASA/GSFC/ASU)',
    });
    viewer.imageryLayers.addImageryProvider(polar);
  } catch (err) {
    status(`Imagery failed to load: ${err.message}`);
  }

  // --- Earth and Sun ---------------------------------------------------------
  const earthEntity = viewer.entities.add({
    name: 'Earth',
    position: new Cesium.Cartesian3(3.8e8, 0, 0),
    orientation: Cesium.Quaternion.IDENTITY,
    ellipsoid: {
      radii: new Cesium.Cartesian3(EARTH_RADIUS_M, EARTH_RADIUS_M, EARTH_RADIUS_M),
      material: Cesium.Color.fromCssColorString('#2d5fa8'),
      slicePartitions: 64,
      stackPartitions: 64,
    },
    label: {
      text: 'Earth',
      font: '600 13px "IBM Plex Sans", system-ui, sans-serif',
      fillColor: Cesium.Color.WHITE,
      pixelOffset: new Cesium.Cartesian2(0, -26),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('rgba(21,25,30,0.8)'),
    },
  });
  earthTexture().then((canvas) => {
    earthEntity.ellipsoid.material = new Cesium.ImageMaterialProperty({ image: canvas });
    scene.requestRender();
  });
  const sunEntity = viewer.entities.add({
    name: 'Sun',
    position: new Cesium.Cartesian3(SUN_SPRITE_DISTANCE_M, 0, 0),
    billboard: { image: sunSprite(), width: 28, height: 28, disableDepthTestDistance: 0 },
    label: {
      text: 'Sun',
      font: '600 13px "IBM Plex Sans", system-ui, sans-serif',
      fillColor: Cesium.Color.WHITE,
      pixelOffset: new Cesium.Cartesian2(0, -24),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString('rgba(21,25,30,0.8)'),
    },
  });

  // --- Sites -------------------------------------------------------------------
  const siteEntities = new Map();
  function siteColor(site, selected) {
    return selected ? Cesium.Color.fromCssColorString('#f2b630') : Cesium.Color.WHITE;
  }
  function setSites(sites) {
    for (const e of siteEntities.values()) viewer.entities.remove(e);
    siteEntities.clear();
    for (const site of sites) {
      const e = viewer.entities.add({
        id: `site:${site.id}`,
        position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0, MOON),
        point: {
          pixelSize: 8,
          color: siteColor(site, false),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: 5.0e5,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.4, 5e6, 0.7),
        },
        label: {
          text: site.short ?? site.name,
          font: '500 12px "IBM Plex Sans", system-ui, sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(10, -10),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: 5.0e5,
          translucencyByDistance: new Cesium.NearFarScalar(2e5, 1, 2.5e6, 0),
        },
      });
      e.siteRef = site;
      siteEntities.set(site.id, e);
    }
    scene.requestRender();
  }
  let selectedId = null;
  const selection = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(0, 0, 0, MOON),
    show: false,
    ellipse: {
      semiMajorAxis: 2500,
      semiMinorAxis: 2500,
      height: 0,
      material: Cesium.Color.fromCssColorString('#f2b630').withAlpha(0.18),
      outline: false,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    },
    point: {
      pixelSize: 13,
      color: Cesium.Color.fromCssColorString('#f2b630'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: 5.0e5,
    },
  });
  function setSelected(site) {
    if (selectedId && siteEntities.get(selectedId)) {
      const prev = siteEntities.get(selectedId);
      prev.point.color = siteColor(prev.siteRef, false);
    }
    selectedId = site?.id ?? null;
    if (site) {
      const e = siteEntities.get(site.id);
      if (e) e.point.color = siteColor(site, true);
      selection.position = Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0, MOON);
      selection.show = true;
    } else selection.show = false;
    scene.requestRender();
  }

  // Direction rays from the selected site toward Sun and Earth (site view aid).
  const rayLength = 40000;
  const sunRay = viewer.entities.add({
    show: false,
    polyline: {
      positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.UNIT_X],
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#f2b630') }),
      arcType: Cesium.ArcType.NONE,
    },
  });
  const earthRay = viewer.entities.add({
    show: false,
    polyline: {
      positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.UNIT_X],
      width: 2,
      material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#7ab8ff') }),
      arcType: Cesium.ArcType.NONE,
    },
  });

  // --- Time ------------------------------------------------------------------------
  const scratch = new Cesium.Cartesian3();
  let currentState = null;
  function setState(state, siteCtx) {
    currentState = state;
    const s = Cesium.Cartesian3.fromArray(state.sun);
    Cesium.Cartesian3.normalize(s, scratch);
    light.direction = Cesium.Cartesian3.negate(scratch, new Cesium.Cartesian3());
    sunEntity.position = Cesium.Cartesian3.multiplyByScalar(scratch, SUN_SPRITE_DISTANCE_M, new Cesium.Cartesian3());
    earthEntity.position = Cesium.Cartesian3.fromArray(state.earth);
    earthEntity.orientation = earthOrientation(state.ms);
    if (siteCtx) {
      const base = Cesium.Cartesian3.fromDegrees(siteCtx.lon, siteCtx.lat, siteCtx.groundHeight + 10, MOON);
      const toSun = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(Cesium.Cartesian3.fromArray(state.sun), base, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      const toEarth = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(Cesium.Cartesian3.fromArray(state.earth), base, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      );
      sunRay.polyline.positions = [base, Cesium.Cartesian3.add(base, Cesium.Cartesian3.multiplyByScalar(toSun, rayLength, toSun), new Cesium.Cartesian3())];
      earthRay.polyline.positions = [base, Cesium.Cartesian3.add(base, Cesium.Cartesian3.multiplyByScalar(toEarth, rayLength, toEarth), new Cesium.Cartesian3())];
      sunRay.show = earthRay.show = true;
    }
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date(state.ms));
    scene.requestRender();
  }

  /** Earth's spin and axial tilt as seen from the Moon (cosmetic, ~0.5 deg). */
  function earthOrientation(ms) {
    const gast = Astronomy.SiderealTime(new Date(ms)) * 15 * DEG;
    const c = Math.cos(gast);
    const s = Math.sin(gast);
    const axis = Astronomy.RotationAxis(Astronomy.Body.Moon, new Date(ms));
    const ex = eqjToMoonFixed([c, s, 0], axis);
    const ey = eqjToMoonFixed([-s, c, 0], axis);
    const ez = eqjToMoonFixed([0, 0, 1], axis);
    const m = new Cesium.Matrix3(ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]);
    return Cesium.Quaternion.fromRotationMatrix(m);
  }

  // --- Camera -----------------------------------------------------------------------
  function flyToSite(site, { altitudeM, duration = 2.2 * motionScale() } = {}) {
    const polar = site.lat < -75;
    const alt = altitudeM ?? (polar ? 90000 : 350000);
    const target = Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 0, MOON);
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1000), {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(polar ? -38 : -60), alt),
      duration,
    });
  }

  /**
   * Stand at the site at the lander's mast height, looking toward an azimuth.
   * The rendered terrain tiles can sit slightly above the analysis grid, so once
   * the flight ends (and the detailed tiles have loaded) the camera is lifted
   * just above the rendered surface if it would otherwise be inside it.
   */
  function siteView(siteCtx, azDeg, pitchDeg = 2) {
    const mast = Math.max(1, (siteCtx.height ?? siteCtx.groundHeight + 2) - siteCtx.groundHeight);
    const orientation = { heading: Cesium.Math.toRadians(azDeg), pitch: Cesium.Math.toRadians(pitchDeg), roll: 0 };
    const at = (h) => Cesium.Cartesian3.fromDegrees(siteCtx.lon, siteCtx.lat, h, MOON);
    const eye = siteCtx.groundHeight + mast + 1;
    viewer.camera.flyTo({
      destination: at(eye),
      orientation,
      duration: 2.5 * motionScale(),
      complete: () => {
        const rendered = scene.globe.getHeight(Cesium.Cartographic.fromDegrees(siteCtx.lon, siteCtx.lat));
        if (Number.isFinite(rendered) && rendered + 1 > eye && rendered - siteCtx.groundHeight < 200) {
          viewer.camera.setView({ destination: at(rendered + mast + 1), orientation });
        }
      },
    });
  }

  function overview() {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(10, -55, 5.2e6, MOON),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-75), roll: 0 },
      duration: 2 * motionScale(),
    });
  }

  /** Pull back beyond the Moon so the Moon, Earth and the Sun's direction share the frame. */
  function earthMoonView() {
    if (!currentState) return;
    const e = Cesium.Cartesian3.normalize(Cesium.Cartesian3.fromArray(currentState.earth), new Cesium.Cartesian3());
    const side = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(e, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const pos = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(e, -9.0e6, new Cesium.Cartesian3()),
      Cesium.Cartesian3.multiplyByScalar(side, 3.2e6, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    const dir = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.subtract(Cesium.Cartesian3.fromArray(currentState.earth), pos, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    );
    const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(dir, Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const up = Cesium.Cartesian3.cross(right, dir, new Cesium.Cartesian3());
    viewer.camera.flyTo({ destination: pos, orientation: { direction: dir, up }, duration: 2.5 * motionScale() });
  }

  function southPole() {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(0, -80.5, 420000, MOON),
      orientation: { heading: Cesium.Math.toRadians(180), pitch: Cesium.Math.toRadians(-62), roll: 0 },
      duration: 2.5 * motionScale(),
    });
  }

  // --- Picking ----------------------------------------------------------------------
  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((ev) => {
    const picked = scene.pick(ev.position);
    if (picked?.id?.siteRef) {
      onPick?.({ site: picked.id.siteRef });
      return;
    }
    let cart = null;
    if (scene.pickPositionSupported) {
      const p = scene.pickPosition(ev.position);
      if (p) cart = MOON.cartesianToCartographic(p);
    }
    if (!cart) {
      const ray = viewer.camera.getPickRay(ev.position);
      const p = ray && scene.globe.pick(ray, scene);
      const q = p ?? viewer.camera.pickEllipsoid(ev.position, MOON);
      if (q) cart = MOON.cartesianToCartographic(q);
    }
    if (cart) onPick?.({ lat: Cesium.Math.toDegrees(cart.latitude), lon: Cesium.Math.toDegrees(cart.longitude) });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // --- Optional Cesium ion: Moon terrain tiles + Artemis candidate landing regions -----------------
  let ionTileset = null;
  let artemisSource = null;
  /** Load the optional Cesium ion assets. Only called with a user-supplied token. */
  async function enableIon(token) {
    if (!token) return { terrain: false, artemis: false };
    Cesium.Ion.defaultAccessToken = token;
    if (ionTileset) scene.primitives.remove(ionTileset);
    if (artemisSource) viewer.dataSources.remove(artemisSource, true);
    ionTileset = artemisSource = null;
    scene.globe.show = true;
    try {
      ionTileset = await Cesium.Cesium3DTileset.fromIonAssetId(2684829, { enableCollision: true });
      ionTileset.shadows = Cesium.ShadowMode.ENABLED;
      scene.primitives.add(ionTileset);
      scene.globe.show = false;
      status('Cesium Moon Terrain (ion) loaded');
    } catch (err) {
      status(`Cesium ion terrain unavailable (${err?.message ?? err}); using bundled LOLA terrain`);
      ionTileset = null;
    }
    try {
      const res = await Cesium.IonResource.fromAssetId(2683531);
      artemisSource = await Cesium.GeoJsonDataSource.load(res, {
        clampToGround: true,
        fill: Cesium.Color.fromBytes(243, 242, 99).withAlpha(0.35),
        stroke: Cesium.Color.fromBytes(243, 242, 99),
      });
      viewer.dataSources.add(artemisSource);
    } catch {
      artemisSource = null;
    }
    return { terrain: !!ionTileset, artemis: !!artemisSource };
  }
  /** 'real' = true Sun direction with shadows; 'flat' = evenly lit for reading terrain. */
  function setLighting(mode) {
    const real = mode !== 'flat';
    scene.globe.enableLighting = real;
    viewer.shadows = real;
    if (ionTileset) ionTileset.shadows = real ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED;
    scene.requestRender();
  }

  function setIonTerrainVisible(on) {
    if (!ionTileset) return;
    ionTileset.show = on;
    scene.globe.show = !on;
    scene.requestRender();
  }

  return {
    viewer,
    setState,
    setSites,
    setSelected,
    flyToSite,
    siteView,
    overview,
    southPole,
    earthMoonView,
    enableIon,
    setIonTerrainVisible,
    setLighting,
    get state() {
      return currentState;
    },
  };
}
