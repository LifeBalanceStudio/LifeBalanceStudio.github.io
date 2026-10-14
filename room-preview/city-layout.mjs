export const CITY_GROUND_COLOR = '#777b75';
export const CITY_PAVEMENT_COLOR = '#8e928b';

// 강변을 따라 넓게 이어지는 단지들이다. 단지마다 건물 방향과 건축 규모를 달리한다.
const districts = [
  { x: -244, z: -177, columns: 3, rows: 4, pitchX: 12, pitchZ: 11.5, angle: -7, kind: '주거단지', height: 18, palette: 0 },
  { x: -197, z: -182, columns: 3, rows: 4, pitchX: 13, pitchZ: 12, angle: 3, kind: '혼합블록', height: 12, palette: 3 },
  { x: -149, z: -173, columns: 3, rows: 3, pitchX: 13, pitchZ: 13, angle: -3, kind: '낮은시가지', height: 6, palette: 2 },
  { x: -101, z: -179, columns: 3, rows: 4, pitchX: 13, pitchZ: 11.5, angle: 7, kind: '주거단지', height: 20, palette: 0 },
  { x: -51, z: -178, columns: 3, rows: 4, pitchX: 13, pitchZ: 12, angle: -5, kind: '혼합블록', height: 13, palette: 2 },
  { x: 0, z: -174, columns: 4, rows: 3, pitchX: 10, pitchZ: 13, angle: 2, kind: '업무지구', height: 22, palette: 4 },
  { x: 49, z: -184, columns: 3, rows: 4, pitchX: 13, pitchZ: 12, angle: -8, kind: '주거단지', height: 17, palette: 1 },
  { x: 97, z: -173, columns: 4, rows: 3, pitchX: 10.5, pitchZ: 13, angle: 5, kind: '혼합블록', height: 11, palette: 3 },
  { x: 146, z: -181, columns: 3, rows: 4, pitchX: 13, pitchZ: 11.5, angle: -2, kind: '주거단지', height: 21, palette: 0 },
  { x: 194, z: -175, columns: 3, rows: 3, pitchX: 13, pitchZ: 12, angle: 8, kind: '낮은시가지', height: 7, palette: 3 },
  { x: 242, z: -182, columns: 3, rows: 4, pitchX: 13, pitchZ: 12, angle: -5, kind: '업무지구', height: 21, palette: 4 }
];

function noise(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function createCityLayout(towerX, towerZ) {
  return districts.map((district, districtIndex) => {
    const rotation = district.angle * Math.PI / 180;
    const c = Math.cos(rotation), s = Math.sin(rotation);
    const buildings = [];
    for (let row = 0; row < district.rows; row++) for (let column = 0; column < district.columns; column++) {
      const seed = (districtIndex + 1) * 131 + row * 19 + column * 7;
      const residential = district.kind === '주거단지';
      const office = district.kind === '업무지구';
      const lowrise = district.kind === '낮은시가지';
      const stagger = (row % 2 - 0.5) * (residential ? 1.4 : 2.2);
      const x = (column - (district.columns - 1) / 2) * district.pitchX + stagger + (noise(seed) - 0.5) * 1.2;
      const z = (row - (district.rows - 1) / 2) * district.pitchZ - (column % 2) * 0.7 + (noise(seed + 1) - 0.5) * 1.4;
      const worldX = district.x + x * c + z * s;
      const worldZ = district.z - x * s + z * c;
      if (Math.abs(worldX - towerX) < 11 && Math.abs(worldZ - towerZ) < 21) continue;

      let height = district.height + (noise(seed + 2) - 0.5) * (residential ? 3 : office ? 6 : 4);
      if (district.kind === '혼합블록') height = noise(seed + 3) < 0.6 ? 5 + noise(seed + 4) * 5 : 12 + noise(seed + 4) * 6;
      height = Math.round(height / 0.9) * 0.9;
      const width = district.pitchX * (residential ? 0.65 + noise(seed + 5) * 0.06 : office ? 0.5 + noise(seed + 5) * 0.09 : 0.45 + noise(seed + 5) * 0.18);
      const depth = district.pitchZ * (residential ? 0.42 + noise(seed + 6) * 0.05 : office ? 0.6 + noise(seed + 6) * 0.08 : 0.45 + noise(seed + 6) * 0.17);
      buildings.push({
        x, z, width, depth, height,
        rotation: residential ? 0 : (noise(seed + 7) - 0.5) * 6 * Math.PI / 180,
        palette: residential || office ? district.palette : (district.palette + Math.floor(noise(seed + 8) * 3)) % 5,
        roofHeight: office ? 0.8 + noise(seed + 9) * 0.7 : lowrise ? 0.25 : 0.4,
        roofOffset: (noise(seed + 10) - 0.5) * width * 0.3
      });
    }
    return { ...district, rotation, buildings };
  });
}
