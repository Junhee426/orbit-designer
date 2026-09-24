import {Globe} from './rendering.js';
import {footprint,groundTrack,orbitRing,groundTrackSurface} from './geometry.js';
import {SAT_COLORS,ORBIT_LINE,ISL_LINE,FOOTPRINT_LINE,GROUND_TRACK_LINE,HEATMAP_EMPTY,HEATMAP_HUE,HEATMAP_SAT,heatmapLightness,satelliteColor,tracePath} from './style.js';
function shapeImage(shape){
  const size=64,c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');
  const r=size/2-3,cx=size/2,cy=size/2;ctx.fillStyle='#fff';ctx.beginPath();
  tracePath(ctx,shape,cx,cy,r);
  ctx.fill();return c;
}
export class OrbitViewer {
  constructor(container,onSelect,worldLines=[]) {
    this.container=container;this.onSelect=onSelect;this.worldLines=worldLines;this.points=new Map();this.layers=[];this.outlineEntities=[];this.selected=null;this.earthStyle='image';this.appliedEarthStyle=null;
    this.uiMode='3d';this.shapeImages={circle:shapeImage('circle'),square:shapeImage('square'),diamond:shapeImage('diamond')};
    this.canvas=document.createElement('canvas');this.canvas.style.cssText='width:100%;height:100%;display:block;touch-action:none';this.canvas.hidden=true;
    this.fallback=new Globe(this.canvas,worldLines);
    try {
      const C=globalThis.Cesium;if(!C)throw Error('지도 라이브러리 없음');this.C=C;
      this.cesiumContainer=document.createElement('div');this.cesiumContainer.style.cssText='width:100%;height:100%';
      container.append(this.cesiumContainer,this.canvas);
      C.Ion.defaultAccessToken='';
      this.viewer=new C.Viewer(this.cesiumContainer,{baseLayer:false,baseLayerPicker:false,geocoder:false,animation:false,timeline:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,skyBox:false,skyAtmosphere:false,requestRenderMode:true,maximumRenderTimeChange:Infinity});
      this.viewer.scene.globe.baseColor=C.Color.fromCssColorString('#12304a');
      this.viewer.scene.backgroundColor=C.Color.fromCssColorString('#081322');
      this.viewer.scene.globe.enableLighting=false;
      // Satellites and lines change on every time step. Primitive collections update them in place;
      // entities rebuilt their geometry (asynchronously, in workers) on each draw.
      this.lines=this.viewer.scene.primitives.add(new C.PolylineCollection());
      this.billboards=this.viewer.scene.primitives.add(new C.BillboardCollection());
      this.colors=new Map();this.pointShape=null;this.observerKey='';this.observerEntities=[];
      C.SingleTileImageryProvider.fromUrl(new URL('./earth.jpg',import.meta.url).href).then(p=>{this.imageryLayer=this.viewer.imageryLayers.addImageryProvider(p);this.applyEarthStyle(this.earthStyle,true);}).catch(()=>{});
      this.viewer.screenSpaceEventHandler.setInputAction(click=>{const p=this.viewer.scene.pick(click.position);if(p?.id?.satId)this.onSelect(p.id.satId);},C.ScreenSpaceEventType.LEFT_CLICK);
      this.center(127,36);
    } catch(error) {
      this.viewer?.destroy();this.viewer=null;this.cesiumContainer=null;
      container.replaceChildren(this.canvas);this.canvas.hidden=false;
      document.getElementById('map-note').textContent='이 환경에서는 간단 지구본으로 표시합니다. 전체 3D 지도에는 WebGL이 필요합니다.';
    }
  }
  get usingCesium(){return !!this.viewer&&(this.uiMode==='3d'||this.uiMode==='2d');}
  setUiMode(mode,redraw=true){
    if(!['3d','2d','2d-globe','2d-map'].includes(mode)||mode===this.uiMode)return;
    this.uiMode=mode;
    const wantCesium=(mode==='3d'||mode==='2d')&&!!this.viewer;
    if(this.cesiumContainer)this.cesiumContainer.hidden=!wantCesium;
    this.canvas.hidden=wantCesium;
    if(!wantCesium)this.fallback.setMode(mode==='2d-map'?'map':'globe',redraw);
  }
  center(lon,lat){if(this.usingCesium)this.viewer.camera.setView({destination:this.C.Cartesian3.fromDegrees(lon,lat,14000000)});else this.fallback.center(lat,lon);}
  zoom(factor){
    if(!Number.isFinite(factor)||factor<=0)return;
    if(!this.usingCesium){this.fallback.zoom(factor);return;}
    const camera=this.viewer.camera,height=camera.positionCartographic.height;
    if(!Number.isFinite(height)||height<=0)return;
    camera.cancelFlight();
    const target=Math.max(100,Math.min(100000000,height/factor));
    camera.zoomIn(height-target);
    this.viewer.scene.requestRender();
  }
  ensureEarthOutline(){
    if(!this.viewer||this.outlineEntities.length)return;
    const C=this.C,v=this.viewer,add=(points,color,width)=>{
      if(points.length<2)return;
      const positions=C.Cartesian3.fromDegreesArrayHeights(points.flatMap(([lat,lon])=>[lon,lat,2500]));
      this.outlineEntities.push(v.entities.add({show:false,polyline:{positions,width,material:C.Color.fromCssColorString(color),arcType:C.ArcType.NONE}}));
    };
    for(let lat=-60;lat<=60;lat+=30)add(Array.from({length:121},(_,i)=>[lat,-180+i*3]),lat===0?'#355d76':'#203f55',.7);
    for(let lon=-180;lon<180;lon+=30)add(Array.from({length:61},(_,i)=>[-90+i*3,lon]),'#203f55',.7);
    for(const line of this.worldLines)add(line,'#5f8aa3',1.1);
  }
  applyEarthStyle(style='image',force=false,redraw=true){
    this.earthStyle=style==='outline'?'outline':'image';this.container.dataset.earthStyle=this.earthStyle;
    this.fallback?.setEarthStyle(this.earthStyle,redraw);
    if(!this.usingCesium)return;
    if(!force&&this.appliedEarthStyle===this.earthStyle)return;
    const outline=this.earthStyle==='outline';if(outline)this.ensureEarthOutline();
    if(this.imageryLayer)this.imageryLayer.show=!outline;
    this.viewer.scene.globe.baseColor=this.C.Color.fromCssColorString(outline?'#091a28':'#12304a');
    for(const entity of this.outlineEntities)entity.show=outline;
    this.appliedEarthStyle=this.earthStyle;
    this.viewer.scene.requestRender();
  }
  update(snapshot,orbits,scenario,observers,selectedId,edges=[],cells=[],showNavigation=false) {
    this.selected=selectedId;
    this.setUiMode(scenario.display.mode,false);
    this.container.dataset.navigation=showNavigation?'visible':'hidden';
    this.applyEarthStyle(scenario.display.earthStyle,false,false);
    this.fallback.setStyle(scenario.display.satShape,scenario.display.satSize,scenario.display.orbitWidth,false);
    if(!this.usingCesium){
      this.fallback.setFull(showNavigation,false);
      this.fallback.setLayers(scenario.display.orbits,scenario.display.isl,scenario.display.heatmap,scenario.display.footprint,scenario.configuration.commElevation);
      this.fallback.set(snapshot,orbits,selectedId,edges,cells);
      return;
    }
    const C=this.C,v=this.viewer;
    const mode=scenario.display.mode==='2d'?C.SceneMode.SCENE2D:C.SceneMode.SCENE3D;
    if(v.scene.mode!==mode){if(mode===C.SceneMode.SCENE2D)v.scene.morphTo2D(0);else v.scene.morphTo3D(0);}
    const xyz=p=>new C.Cartesian3(p[0]*1000,p[1]*1000,p[2]*1000);
    const color=css=>{let c=this.colors.get(css);if(!c){c=C.Color.fromCssColorString(css);this.colors.set(css,c);}return c;};
    const satSize=scenario.display.satSize??1,orbitWidth=scenario.display.orbitWidth??1;
    const shape=this.shapeImages[scenario.display.satShape]?scenario.display.satShape:'circle',satImage=this.shapeImages[shape];
    // A stable image id lets the texture atlas reuse the shape instead of adding a copy per assignment.
    const reshape=this.pointShape!==shape;this.pointShape=shape;
    const keep=new Set(),scratch=new C.Cartesian3();
    for(const sat of snapshot.satellites){if(!showNavigation&&sat.group!=='LEO')continue;keep.add(sat.id);let b=this.points.get(sat.id);
      if(!b){b=this.billboards.add({id:{satId:sat.id}});b.setImage(shape,satImage);this.points.set(sat.id,b);}
      else if(reshape)b.setImage(shape,satImage);
      b.position=C.Cartesian3.fromElements(sat.position[0]*1000,sat.position[1]*1000,sat.position[2]*1000,scratch);
      const navUsed=showNavigation&&sat.navUsed;
      const px=(sat.id===selectedId?11:navUsed||sat.link?7:3)*satSize;
      b.width=px;b.height=px;
      b.color=color(satelliteColor({selected:sat.id===selectedId,chosen:sat.id===snapshot.best?.id,group:sat.group,navUsed,link:sat.link}));
    }
    for(const [id,b]of this.points)if(!keep.has(id)){this.billboards.remove(b);this.points.delete(id);}
    let used=0;
    const line=(positions,css,width=1)=>{
      const p=used<this.lines.length?this.lines.get(used):this.lines.add();used++;
      p.show=true;p.positions=positions.map(xyz);p.width=width;C.Color.clone(color(css),p.material.uniforms.color);
    };
    v.entities.suspendEvents();
    for(const e of this.layers)v.entities.remove(e);this.layers=[];
    const add=x=>{const e=v.entities.add(x);this.layers.push(e);return e;};
    const observerKey=JSON.stringify(observers.map(o=>[o.name,o.lat,o.lon]));
    if(observerKey!==this.observerKey){
      for(const e of this.observerEntities)v.entities.remove(e);this.observerKey=observerKey;
      this.observerEntities=observers.map(o=>v.entities.add({position:C.Cartesian3.fromDegrees(o.lon,o.lat),point:{pixelSize:6,color:C.Color.fromCssColorString('#e8f2fc')},label:{text:o.name,font:'12px sans-serif',fillColor:C.Color.WHITE,pixelOffset:new C.Cartesian2(0,-14),distanceDisplayCondition:new C.DistanceDisplayCondition(0,40000000)}}));
    }
    if(snapshot.best)line([snapshot.observer,snapshot.best.position],SAT_COLORS.best,2);
    if(scenario.display.orbits){const seen=new Set();for(const o of orbits){if(!showNavigation&&o.group!=='LEO')continue;const key=o.satrec?o.id:o.group==='LEO'?`${o.shell}:${o.plane}`:`${o.group}:${o.raan}:${o.inclination}`;if(seen.has(key))continue;seen.add(key);
      if(o.satrec){line(groundTrack(o,snapshot.minutes),ORBIT_LINE,orbitWidth);continue;}
      line(orbitRing(o,snapshot.minutes,65),ORBIT_LINE,orbitWidth);
    }}
    const byId=new Map(snapshot.satellites.map(s=>[s.id,s]));
    if(scenario.display.isl)for(const e of edges)line([byId.get(e.a).position,byId.get(e.b).position],ISL_LINE);
    if(scenario.display.heatmap)for(const cell of cells)add({rectangle:{coordinates:C.Rectangle.fromDegrees(cell.west,cell.south,cell.east,cell.north),height:1000,material:(cell.count?C.Color.fromHsl(HEATMAP_HUE/360,HEATMAP_SAT/100,heatmapLightness(cell.count)/100):C.Color.fromCssColorString(HEATMAP_EMPTY)).withAlpha(.55)}});
    const selected=byId.get(selectedId),orbit=orbits.find(o=>o.id===selectedId);
    if(selected&&scenario.display.footprint){const coords=footprint(selected.position,scenario.configuration.commElevation).flat();if(coords.length)add({polyline:{positions:C.Cartesian3.fromDegreesArray(coords),width:2,material:C.Color.fromCssColorString(FOOTPRINT_LINE)}});}
    if(orbit&&selected){line(groundTrackSurface(orbit,snapshot.minutes),GROUND_TRACK_LINE,2);}
    // Release lines a layer no longer needs (e.g. ISL switched off) instead of keeping them hidden.
    // Collect first: length/get() compact the collection after each remove().
    const surplus=[];for(let i=used;i<this.lines.length;i++)surplus.push(this.lines.get(i));
    for(const p of surplus)this.lines.remove(p);
    v.entities.resumeEvents();v.scene.requestRender();
  }
}
