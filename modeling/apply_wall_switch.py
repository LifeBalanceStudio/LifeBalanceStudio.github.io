"""천장등 추가 도구와 같은 방식으로 원본 GLB를 보존하며 벽 스위치만 덧붙인다."""

import copy
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "output"
BASE = ROOT / "revisions" / "wall-switch-before-2026-09-13"
PART = OUTPUT / "wall-switch.glb"
sys.path.insert(0, str(ROOT))
from wall_switch_model import add_wall_switch


def read_glb(path):
    raw = path.read_bytes()
    assert struct.unpack_from("<II", raw) == (0x46546C67, 2)
    cursor, document, binary = 12, None, None
    while cursor < len(raw):
        length, kind = struct.unpack_from("<II", raw, cursor)
        data = raw[cursor + 8:cursor + 8 + length]
        if kind == 0x4E4F534A:
            document = json.loads(data)
        elif kind == 0x004E4942:
            binary = data
        cursor += 8 + length
    assert document is not None and binary is not None
    return document, binary


document, original_binary = read_glb(OUTPUT / "room.glb")
baseline, baseline_binary = read_glb(BASE / "room.glb")
assert document == baseline and original_binary == baseline_binary, "기준 보존 후 모델이 변경되었습니다."
assert not any(node.get("name") == "천장등_벽스위치" for node in document["nodes"]), "이미 벽 스위치가 있습니다."
original = copy.deepcopy(document)

bpy.ops.wm.open_mainfile(filepath=str(OUTPUT / "room.blend"))
switch = add_wall_switch()
bpy.ops.object.select_all(action="DESELECT")
switch.select_set(True)
for child in switch.children:
    child.select_set(True)
bpy.context.view_layer.objects.active = switch
bpy.ops.export_scene.gltf(filepath=str(PART), export_format="GLB", use_selection=True,
                          export_animations=False, export_extras=True, export_cameras=False, export_lights=False)

added, added_binary = read_glb(PART)
assert not any(added.get(key) for key in ["textures", "images", "skins", "animations"])
assert len(added["meshes"]) == 2
offsets = {key: len(document.get(key, [])) for key in ["bufferViews", "accessors", "materials", "meshes", "nodes"]}
binary = bytearray(original_binary)
binary.extend(b"\0" * (-len(binary) % 4))
binary_offset = len(binary)
binary.extend(added_binary)
binary.extend(b"\0" * (-len(binary) % 4))
for view in added["bufferViews"]:
    view["buffer"] = 0
    view["byteOffset"] = view.get("byteOffset", 0) + binary_offset
for accessor in added["accessors"]:
    accessor["bufferView"] += offsets["bufferViews"]
for mesh in added["meshes"]:
    for primitive in mesh["primitives"]:
        primitive["attributes"] = {key: value + offsets["accessors"] for key, value in primitive["attributes"].items()}
        primitive["indices"] += offsets["accessors"]
        primitive["material"] += offsets["materials"]
for node in added["nodes"]:
    if "mesh" in node:
        node["mesh"] += offsets["meshes"]
    if "children" in node:
        node["children"] = [index + offsets["nodes"] for index in node["children"]]
for key in offsets:
    document.setdefault(key, []).extend(added.get(key, []))
document["scenes"][document.get("scene", 0)]["nodes"].extend(index + offsets["nodes"] for index in added["scenes"][added.get("scene", 0)]["nodes"])
document["buffers"][0]["byteLength"] = len(binary)
for key in ["extensionsUsed", "extensionsRequired"]:
    if key in added:
        document[key] = list(dict.fromkeys(document.get(key, []) + added[key]))
for key in offsets:
    assert document[key][:offsets[key]] == original.get(key, [])
assert binary[:len(original_binary)] == original_binary
encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
encoded += b" " * (-len(encoded) % 4)
size = 12 + 8 + len(encoded) + 8 + len(binary)
result = struct.pack("<III", 0x46546C67, 2, size)
result += struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
result += struct.pack("<II", len(binary), 0x004E4942) + binary
(OUTPUT / "room.glb").write_bytes(result)
(ROOT.parent / "room-preview" / "assets" / "room.glb").write_bytes(result)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "room.blend"))
report = {"기존_메시_보존": offsets["meshes"], "추가_메시": len(added["meshes"]), "기존_버퍼_보존": True,
          "전체_메시": len(document["meshes"]), "바이트": size, "SHA256": hashlib.sha256(result).hexdigest()}
(OUTPUT / "wall-switch-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False), flush=True)
