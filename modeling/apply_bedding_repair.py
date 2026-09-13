"""기존 방에 두 침구의 좌표·두께 방향을 반영하고 다른 메시·재질·변환을 보존한다."""

import json
import shutil
import struct
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parent
BASE = ROOT / "revisions" / "bedding-before-2026-09-12"
OUTPUT = ROOT / "output"
GENERATED = OUTPUT / "bedding-generated"
NAMES = ("이불_고정주름", "황토색_담요")
GENERATED.mkdir(exist_ok=True)
for suffix in ("blend", "glb"):
    shutil.copy2(OUTPUT / ("room." + suffix), GENERATED / ("room." + suffix))

bpy.ops.wm.open_mainfile(filepath=str(GENERATED / "room.blend"))
coordinates = {}
polygons = {}
offsets = {}
for name in NAMES:
    mesh = bpy.data.objects[name].data
    coordinates[name] = [tuple(vertex.co) for vertex in mesh.vertices]
    polygons[name] = [tuple(face.vertices) for face in mesh.polygons]
    offsets[name] = bpy.data.objects[name].modifiers["천_두께"].offset

bpy.ops.wm.open_mainfile(filepath=str(BASE / "room.blend"))
for name in NAMES:
    mesh = bpy.data.objects[name].data
    assert len(mesh.vertices) == len(coordinates[name]), "침구 정점 수가 달라짐"
    assert [tuple(face.vertices) for face in mesh.polygons] == polygons[name], "침구 면 연결이 달라짐"
    for vertex, coordinate in zip(mesh.vertices, coordinates[name]):
        vertex.co = coordinate
    mesh.update()
    bpy.data.objects[name].modifiers["천_두께"].offset = offsets[name]
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "room.blend"))


def read_glb(path):
    data = path.read_bytes()
    assert struct.unpack_from("<II", data) == (0x46546C67, 2)
    offset, document, binary = 12, None, None
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        payload = data[offset + 8:offset + 8 + length]
        if kind == 0x4E4F534A:
            document = json.loads(payload)
        elif kind == 0x004E4942:
            binary = bytearray(payload)
        offset += 8 + length
    assert document is not None and binary is not None
    return document, binary


def layout(document, index):
    accessor = document["accessors"][index]
    view = document["bufferViews"][accessor["bufferView"]]
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
    sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    size = components[accessor["type"]] * sizes[accessor["componentType"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return accessor, start, view.get("byteStride", size), size


document, binary = read_glb(BASE / "room.glb")
generated, generated_binary = read_glb(GENERATED / "room.glb")
copied = {}
for name in NAMES:
    node = next(node for node in document["nodes"] if node.get("name") == name)
    source_node = next(node for node in generated["nodes"] if node.get("name") == name)
    primitives = document["meshes"][node["mesh"]]["primitives"]
    source_primitives = generated["meshes"][source_node["mesh"]]["primitives"]
    assert len(primitives) == len(source_primitives)
    for primitive, source in zip(primitives, source_primitives):
        assert primitive.get("material") == source.get("material")
        assert primitive["attributes"].keys() == source["attributes"].keys()
        pairs = [(primitive["attributes"][key], source["attributes"][key]) for key in primitive["attributes"]]
        pairs.append((primitive["indices"], source["indices"]))
        for target_index, source_index in pairs:
            target, target_start, target_stride, size = layout(document, target_index)
            src, source_start, source_stride, source_size = layout(generated, source_index)
            assert all(target.get(key) == src.get(key) for key in ("count", "type", "componentType", "normalized"))
            assert size == source_size
            rows = [generated_binary[source_start + i * source_stride:source_start + i * source_stride + size] for i in range(src["count"])]
            # 두 침구가 공유하는 인덱스를 서로 다른 값으로 덮어쓰지 않게 확인한다.
            packed = b"".join(rows)
            assert target_index not in copied or copied[target_index] == packed
            copied[target_index] = packed
            for i, row in enumerate(rows):
                start = target_start + i * target_stride
                binary[start:start + size] = row
            for key in ("min", "max"):
                if key in src:
                    target[key] = src[key]

encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
encoded += b" " * (-len(encoded) % 4)
length = 12 + 8 + len(encoded) + 8 + len(binary)
result = struct.pack("<III", 0x46546C67, 2, length)
result += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
result += struct.pack("<II", len(binary), 0x004E4942) + binary
(OUTPUT / "room.glb").write_bytes(result)
print("기존 방 보존 후 두 침구 반영 완료", flush=True)
