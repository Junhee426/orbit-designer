import {Globe} from './rendering.js';
import {orbitState} from './engine.js';
import {footprint,groundTrack} from './geometry.js';
export class OrbitViewer {
  constructor(container,onSelect,worldLines=[]) {
    this.container=container;this.onSelect=onSelect;this.worldLines=worldLines;this.points=new Map();this.layers=[];this.outlineEntities=[];this.selected=null;this.earthStyle='image';this.appliedEarthStyle=null;
    try {
      const C=globalThis.Cesium;if(!C)throw Error('지도 라이브러리 없음');this.C=C;
      C.Ion.defaultAccessToken='';
      this.viewer=new C.Viewer(container,{baseLayer:false,baseLayerPicker:false,geocoder:false,animation:false,timeline:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,skyBox:false,skyAtmosphere:false,requestRenderMode:true,maximumRenderTimeChange:Infinity});
      this.viewer.scene.globe.baseColor=C.Color.fromCssColorString('#12304a');
      this.viewer.scene.backgroundColor=C.Color.fromCssColorString('#081322');
      this.viewer.scene.globe.enableLighting=false;
      C.SingleTileImageryProvider.fromUrl(new URL('./earth.jpg',import.meta.url).href).then(p=>{this.imageryLayer=this.viewer.imageryLayers.addImageryProvider(p);this.applyEarthStyle(this.earthStyle,true);}).catch(()=>{});
      this.viewer.screenSpaceEventHandler.setInputAction(click=>{const p=this.viewer.scene.pick(click.position);if(p?.id?.satId)this.onSelect(p.id.satId);},C.ScreenSpaceEventType.LEFT_CLICK);
      this.center(127,36);
    } catch(error) {
      this.viewer?.destroy();this.viewer=null;container.replaceChildren();
      const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%';container.append(canvas);this.fallback=new Globe(canvas,worldLines);
      document.getElementById('map-note').textContent='이 환경에서는 간단 지구본으로 표시합니다. 전체 3D 지도에는 WebGL이 필요합니다.';
    }
  }
  center(lon,lat){if(this.viewer)this.viewer.camera.setView({destination:this.C.Cartesian3.fromDegrees(lon,lat,14000000)});else this.fallback.center(lat,lon);}
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
  applyEarthStyle(style='image',force=false){
    this.earthStyle=style==='outline'?'outline':'image';this.container.dataset.earthStyle=this.earthStyle;
    if(!this.viewer){this.fallback?.setEarthStyle(this.earthStyle);return;}
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
    this.container.dataset.navigation=showNavigation?'visible':'hidden';
    this.applyEarthStyle(scenario.display.earthStyle);
    if(!this.viewer){this.fallback.setFull(showNavigation);this.fallback.set(snapshot,orbits);return;}
    const C=this.C,v=this.viewer;
    const mode=scenario.display.mode==='2D'?C.SceneMode.SCENE2D:C.SceneMode.SCENE3D;
    if(v.scene.mode!==mode){if(mode===C.SceneMode.SCENE2D)v.scene.morphTo2D(0);else v.scene.morphTo3D(0);}
    const xyz=p=>new C.Cartesian3(...p.map(x=>x*1000));
    v.entities.suspendEvents();
    const keep=new Set();
    for(const sat of snapshot.satellites){if(!showNavigation&&sat.group!=='LEO')continue;keep.add(sat.id);let entity=this.points.get(sat.id);
      if(!entity){entity=v.entities.add({id:sat.id,point:{pixelSize:4}});entity.satId=sat.id;this.points.set(sat.id,entity);}
      entity.position=xyz(sat.position);
      entity.point.pixelSize=sat.id===selectedId?11:sat.navUsed||sat.link?7:3;
      entity.point.color=C.Color.fromCssColorString(sat.id===selectedId?'#ffffff':sat.id===snapshot.best?.id?'#ffb55d':sat.group==='GNSS'?'#e3ad65':sat.group==='REGIONAL'?'#b4a0ff':sat.navUsed?'#47dacb':sat.link?'#74b6ff':'#53657a');
    }
    for(const [id,e]of this.points)if(!keep.has(id)){v.entities.remove(e);this.points.delete(id);}
    for(const e of this.layers)v.entities.remove(e);this.layers=[];
    const add=x=>{const e=v.entities.add(x);this.layers.push(e);return e;};
    const line=(positions,color,width=1)=>add({polyline:{positions:positions.map(xyz),width,material:C.Color.fromCssColorString(color),arcType:C.ArcType.NONE}});
    for(const o of observers)add({position:C.Cartesian3.fromDegrees(o.lon,o.lat),point:{pixelSize:6,color:C.Color.fromCssColorString('#e8f2fc')},label:{text:o.name,font:'12px sans-serif',fillColor:C.Color.WHITE,pixelOffset:new C.Cartesian2(0,-14),distanceDisplayCondition:new C.DistanceDisplayCondition(0,40000000)}});
    if(snapshot.best)line([snapshot.observer,snapshot.best.position],'#ffb55d',2);
    if(scenario.display.orbits){const seen=new Set();for(const o of orbits){if(!showNavigation&&o.group!=='LEO')continue;const key=o.group==='LEO'?`${o.shell}:${o.plane}`:o.group;if(seen.has(key))continue;seen.add(key);
      if(o.satrec){line(groundTrack(o,snapshot.minutes),'#344f6a');continue;}
      const positions=Array.from({length:65},(_,i)=>orbitState(o,snapshot.minutes*60,2*Math.PI*i/64).position);line(positions,'#344f6a');
    }}
    const byId=new Map(snapshot.satellites.map(s=>[s.id,s]));
    if(scenario.display.isl)for(const e of edges)line([byId.get(e.a).position,byId.get(e.b).position],'#36685f');
    if(scenario.display.heatmap)for(const cell of cells)add({rectangle:{coordinates:C.Rectangle.fromDegrees(cell.west,cell.south,cell.east,cell.north),height:1000,material:(cell.count?C.Color.fromHsl(.48,.7,.3+Math.min(cell.count,12)/40):C.Color.fromCssColorString('#c45259')).withAlpha(.55)}});
    const selected=byId.get(selectedId),orbit=orbits.find(o=>o.id===selectedId);
    if(selected&&scenario.display.footprint){const coords=footprint(selected.position,scenario.configuration.commElevation).flat();if(coords.length)add({polyline:{positions:C.Cartesian3.fromDegreesArray(coords),width:2,material:C.Color.fromCssColorString('#84e5df')}});}
    if(orbit&&selected){line(groundTrack(orbit,snapshot.minutes).map(p=>{const scale=6378.137/Math.hypot(...p);return p.map(v=>v*scale);}),'#e8db91',2);}
    v.entities.resumeEvents();v.scene.requestRender();
  }
}
