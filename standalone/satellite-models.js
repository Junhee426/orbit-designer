// Assets are copied from the Docker frontend into the static publish directory at build time.
export const SATELLITE_MODELS = {
  default: {file:'kleo_satellite.glb', label:'기본형', description:'중앙 본체와 양쪽 태양전지판'},
  compact: {file:'kleo_satellite_compact.glb', label:'소형 버스', description:'작은 본체와 짧은 패널'},
  broadband: {file:'kleo_satellite_broadband.glb', label:'광대역 통신형', description:'넓은 패널과 통신 안테나'},
  flatpanel: {file:'kleo_satellite_flatpanel.glb', label:'평판 통신형', description:'납작한 본체와 평판 안테나'},
  cubesat: {file:'kleo_satellite_cubesat.glb', label:'큐브샛', description:'세로형 소형 본체와 네 방향 패널'},
  radar: {file:'kleo_satellite_radar.glb', label:'레이더 관측형', description:'긴 레이더 안테나와 한쪽 태양전지판'},
  telescope: {file:'kleo_satellite_telescope.glb', label:'우주망원경형', description:'원통형 경통과 양쪽 패널'},
};
export const hasSatelliteModel = key => typeof key==='string'&&Object.hasOwn(SATELLITE_MODELS,key);
