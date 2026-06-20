"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type SceneApi = {
  animate?: (time: number) => void;
  cleanup?: () => void;
  onPointerDown?: (input: { raycaster: THREE.Raycaster; pointer: THREE.Vector2; event: PointerEvent }) => void;
};

type SceneBuilder = (ctx: {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
}) => SceneApi | void;

type Block3D = {
  color: string;
  id: string;
  x: number;
  y: number;
  z: number;
};

type StickerPattern = {
  dataUrl: string;
  updatedAt: number;
};

type CubeFaceSelection = {
  color: string;
  index: number;
  label: string;
  planeId: number;
};

type DrawTool = "free" | "line" | "square" | "circle" | "triangle" | "cross" | "diagonal";

const faceLabels = ["右面", "左面", "上面", "下面", "前面", "后面"];
const faceShortLabels = ["右", "左", "上", "下", "前", "后"];
const faceOpposite: Record<string, string> = {
  右面: "左面",
  左面: "右面",
  上面: "下面",
  下面: "上面",
  前面: "后面",
  后面: "前面",
};

const palette = ["#4f7fc7", "#3f8f78", "#e56f4e", "#f4d06f", "#7c63c7", "#3b9b91"];
const stickerImageCache = new Map<string, HTMLImageElement>();

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

function makeFaceTexture(label: string, color: string, selected = false, sticker?: StickerPattern) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = selected ? "#e56f4e" : color;
  ctx.lineWidth = selected ? 16 : 10;
  ctx.strokeRect(10, 10, 236, 236);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  if (sticker?.dataUrl) {
    const drawSticker = (image: HTMLImageElement) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(image, 20, 20, 216, 216);
      ctx.strokeStyle = selected ? "#e56f4e" : color;
      ctx.lineWidth = selected ? 16 : 10;
      ctx.strokeRect(10, 10, 236, 236);
      texture.needsUpdate = true;
    };
    const cachedImage = stickerImageCache.get(sticker.dataUrl);
    if (cachedImage?.complete) {
      drawSticker(cachedImage);
    } else {
      const image = cachedImage || new Image();
      stickerImageCache.set(sticker.dataUrl, image);
      image.onload = () => drawSticker(image);
      image.src = sticker.dataUrl;
    }
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "bold 92px Microsoft YaHei, PingFang SC, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(15,23,42,0.18)";
    ctx.shadowBlur = 8;
    ctx.fillText(label, 128, 132);
    ctx.shadowBlur = 0;
  }

  return texture;
}

function makeLabelSprite(text: string, color = "#26322d") {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 120;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.SpriteMaterial();
  ctx.fillStyle = "rgba(253,255,251,0.92)";
  ctx.roundRect(12, 16, 296, 88, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 160, 62);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: texture, transparent: true });
}

function ThreeStage({ buildScene, sceneKey }: { buildScene: SceneBuilder; sceneKey: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const buildRef = useRef(buildScene);

  useEffect(() => {
    buildRef.current = buildScene;
  }, [buildScene]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f7fbf6");
    const width = Math.max(320, mount.clientWidth);
    const height = Math.max(360, mount.clientHeight);
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(5, 4.5, 7);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 16;

    const hemi = new THREE.HemisphereLight("#ffffff", "#d9e6dc", 2.4);
    scene.add(hemi);
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.2);
    keyLight.position.set(6, 8, 6);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight("#dff1f5", 0.9);
    fillLight.position.set(-4, 3, -5);
    scene.add(fillLight);

    const api = buildRef.current({ camera, controls, renderer, scene }) || {};
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handlePointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      api.onPointerDown?.({ event, pointer, raycaster });
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(320, mount.clientWidth);
      const nextHeight = Math.max(360, mount.clientHeight);
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    });
    resizeObserver.observe(mount);

    let raf = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      api.animate?.(clock.getElapsedTime());
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      api.cleanup?.();
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [sceneKey]);

  return (
    <div
      ref={mountRef}
      className="three-stage min-h-[560px] overflow-hidden"
      data-three-stage="1"
      style={{ background: "#f5f5f5" }}
    />
  );
}

function ControlButton({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg px-3 py-2 text-xs font-semibold"
      style={{
        background: active ? "var(--primary)" : "var(--surface)",
        color: active ? "white" : "var(--slate)",
      }}
    >
      {children}
    </button>
  );
}

const redMainButtonStyle: CSSProperties = {
  padding: "8px 16px",
  background: "#b11e1a",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  boxShadow: "0 2px 5px rgba(177,30,26,.28)",
};

const glassButtonStyle: CSSProperties = {
  padding: "6px 12px",
  background: "rgba(255,255,255,.9)",
  color: "#333",
  border: "1px solid #e5e5e5",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  boxShadow: "0 2px 4px rgba(0,0,0,.1)",
};

const editorOutlineButtonStyle: CSSProperties = {
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  borderRadius: 5,
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
  height: 36,
};

const editorFooterButtonStyle: CSSProperties = {
  border: "1px solid",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 16,
  fontWeight: 700,
  height: 40,
  minWidth: 76,
  padding: "0 18px",
};

const editorTopButtonStyle: CSSProperties = {
  border: "1px solid",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
  height: 34,
  minWidth: 74,
  padding: "0 12px",
  whiteSpace: "nowrap",
};

const toggleButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 999,
  padding: "6px 12px",
  background: "transparent",
  color: "#666",
  fontSize: 12,
  fontWeight: 700,
};

const toggleActiveStyle: CSSProperties = {
  ...toggleButtonStyle,
  background: "#b11e1a",
  color: "#fff",
};

type CubeNetCell = {
  color: string;
  x: number;
  y: number;
};

type CubeNetPlane = {
  cells: CubeNetCell[];
  id: number;
  type: "1-4-1型" | "1-3-2型" | "3-3型";
};

const cubeNetColors = {
  blue: "#6fa9e4",
  brown: "#b1a18c",
  green: "#8bcb8f",
  purple: "#b58bd0",
  red: "#d75e58",
  yellow: "#f4bd52",
};

const cubeNetPlanes: CubeNetPlane[] = [
  {
    id: 1,
    type: "1-4-1型",
    cells: [
      { x: 1, y: 0, color: cubeNetColors.brown },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 3, y: 1, color: cubeNetColors.green },
      { x: 1, y: 2, color: cubeNetColors.blue },
    ],
  },
  {
    id: 2,
    type: "1-4-1型",
    cells: [
      { x: 2, y: 0, color: cubeNetColors.brown },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 3, y: 1, color: cubeNetColors.green },
      { x: 1, y: 2, color: cubeNetColors.blue },
    ],
  },
  {
    id: 3,
    type: "1-4-1型",
    cells: [
      { x: 3, y: 0, color: cubeNetColors.brown },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 3, y: 1, color: cubeNetColors.green },
      { x: 1, y: 2, color: cubeNetColors.blue },
    ],
  },
  {
    id: 4,
    type: "1-4-1型",
    cells: [
      { x: 0, y: 0, color: cubeNetColors.brown },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 3, y: 1, color: cubeNetColors.green },
      { x: 1, y: 2, color: cubeNetColors.blue },
    ],
  },
  {
    id: 5,
    type: "1-4-1型",
    cells: [
      { x: 0, y: 0, color: cubeNetColors.brown },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 3, y: 1, color: cubeNetColors.green },
      { x: 0, y: 2, color: cubeNetColors.blue },
    ],
  },
  {
    id: 6,
    type: "1-4-1型",
    cells: [
      { x: 0, y: 0, color: cubeNetColors.brown },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 3, y: 1, color: cubeNetColors.green },
      { x: 3, y: 2, color: cubeNetColors.blue },
    ],
  },
  {
    id: 7,
    type: "1-3-2型",
    cells: [
      { x: 0, y: 0, color: cubeNetColors.brown },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 2, y: 2, color: cubeNetColors.blue },
      { x: 3, y: 2, color: cubeNetColors.green },
    ],
  },
  {
    id: 8,
    type: "1-3-2型",
    cells: [
      { x: 1, y: 0, color: cubeNetColors.brown },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 2, y: 2, color: cubeNetColors.blue },
      { x: 3, y: 2, color: cubeNetColors.green },
    ],
  },
  {
    id: 9,
    type: "1-3-2型",
    cells: [
      { x: 2, y: 0, color: cubeNetColors.brown },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 2, y: 2, color: cubeNetColors.blue },
      { x: 3, y: 2, color: cubeNetColors.green },
    ],
  },
  {
    id: 10,
    type: "1-3-2型",
    cells: [
      { x: 0, y: 0, color: cubeNetColors.red },
      { x: 1, y: 0, color: cubeNetColors.brown },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
      { x: 2, y: 2, color: cubeNetColors.blue },
      { x: 3, y: 2, color: cubeNetColors.green },
    ],
  },
  {
    id: 11,
    type: "3-3型",
    cells: [
      { x: 2, y: 0, color: cubeNetColors.brown },
      { x: 3, y: 0, color: cubeNetColors.green },
      { x: 4, y: 0, color: cubeNetColors.blue },
      { x: 0, y: 1, color: cubeNetColors.red },
      { x: 1, y: 1, color: cubeNetColors.yellow },
      { x: 2, y: 1, color: cubeNetColors.purple },
    ],
  },
];

function CubeNetThumbnail({ cells }: { cells: CubeNetCell[] }) {
  const cellSize = 15;
  const minX = Math.min(...cells.map((cell) => cell.x));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxY = Math.max(...cells.map((cell) => cell.y));

  return (
    <div
      style={{
        height: (maxY - minY + 1) * cellSize,
        margin: "10px auto 0",
        position: "relative",
        width: (maxX - minX + 1) * cellSize,
      }}
    >
      {cells.map((cell, index) => (
        <span
          key={`${cell.x}-${cell.y}-${index}`}
          style={{
            background: cell.color,
            border: "1px solid #222",
            boxSizing: "border-box",
            height: cellSize,
            left: (cell.x - minX) * cellSize,
            position: "absolute",
            top: (cell.y - minY) * cellSize,
            width: cellSize,
          }}
        />
      ))}
    </div>
  );
}

function stickerKey(faceLabel: string) {
  return faceLabel;
}

function rotateVectorAroundAxis(vector: THREE.Vector3, axis: THREE.Vector3, angle: number) {
  return vector.clone().applyAxisAngle(axis.clone().normalize(), angle);
}

function labelFromNormal(normal: THREE.Vector3) {
  const candidates = [
    { label: "右面", vector: new THREE.Vector3(1, 0, 0) },
    { label: "左面", vector: new THREE.Vector3(-1, 0, 0) },
    { label: "上面", vector: new THREE.Vector3(0, 1, 0) },
    { label: "下面", vector: new THREE.Vector3(0, -1, 0) },
    { label: "前面", vector: new THREE.Vector3(0, 0, 1) },
    { label: "后面", vector: new THREE.Vector3(0, 0, -1) },
  ];
  return candidates
    .map((item) => ({ ...item, score: item.vector.dot(normal) }))
    .sort((a, b) => b.score - a.score)[0].label;
}

function getFoldedFaceLabels(plane: CubeNetPlane) {
  const rootIndex = Math.max(0, plane.cells.findIndex((cell) => cell.color === cubeNetColors.yellow));
  const keyToIndex = new Map(plane.cells.map((cell, index) => [`${cell.x},${cell.y}`, index]));
  const parentIndex = Array<number | null>(plane.cells.length).fill(null);
  const visitOrder: number[] = [];
  const queue = [rootIndex];
  const visited = new Set(queue);

  while (queue.length) {
    const currentIndex = queue.shift()!;
    visitOrder.push(currentIndex);
    const cell = plane.cells[currentIndex];
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].forEach(([dx, dy]) => {
      const nextIndex = keyToIndex.get(`${cell.x + dx},${cell.y + dy}`);
      if (typeof nextIndex === "number" && !visited.has(nextIndex)) {
        visited.add(nextIndex);
        parentIndex[nextIndex] = currentIndex;
        queue.push(nextIndex);
      }
    });
  }
  plane.cells.forEach((_, index) => {
    if (!visited.has(index)) {
      parentIndex[index] = rootIndex;
      visitOrder.push(index);
    }
  });

  type Basis = { n: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 };
  const basis: Array<Basis | undefined> = [];
  basis[rootIndex] = {
    n: new THREE.Vector3(0, 1, 0),
    u: new THREE.Vector3(1, 0, 0),
    v: new THREE.Vector3(0, 0, 1),
  };

  visitOrder.forEach((index) => {
    if (index === rootIndex) return;
    const parent = parentIndex[index] ?? rootIndex;
    const parentBasis = basis[parent];
    if (!parentBasis) return;
    const cell = plane.cells[index];
    const parentCell = plane.cells[parent];
    const dx = Math.sign(cell.x - parentCell.x);
    const dy = Math.sign(cell.y - parentCell.y);
    const axis = dx === 0 ? parentBasis.u : parentBasis.v;
    const angle = dx > 0 ? Math.PI / 2 : dx < 0 ? -Math.PI / 2 : dy > 0 ? -Math.PI / 2 : Math.PI / 2;
    basis[index] = {
      n: rotateVectorAroundAxis(parentBasis.n, axis, angle),
      u: rotateVectorAroundAxis(parentBasis.u, axis, angle),
      v: rotateVectorAroundAxis(parentBasis.v, axis, angle),
    };
  });

  return plane.cells.map((_, index) => labelFromNormal(basis[index]?.n || new THREE.Vector3(0, 1, 0)));
}

function getCanvasPoint(canvas: HTMLCanvasElement, event: React.PointerEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function drawStickerShape(
  ctx: CanvasRenderingContext2D,
  tool: Exclude<DrawTool, "free">,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const size = Math.max(24, Math.min(width || 150, height || 150));
  const centerX = start.x + (end.x - start.x) / 2;
  const centerY = start.y + (end.y - start.y) / 2;

  ctx.beginPath();
  if (tool === "line") {
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
  } else if (tool === "square") {
    ctx.rect(minX, minY, width || size, height || size);
  } else if (tool === "circle") {
    ctx.ellipse(centerX, centerY, Math.max(16, width / 2 || 70), Math.max(16, height / 2 || 70), 0, 0, Math.PI * 2);
  } else if (tool === "triangle") {
    ctx.moveTo(centerX, minY);
    ctx.lineTo(minX, minY + Math.max(size, height));
    ctx.lineTo(minX + Math.max(size, width), minY + Math.max(size, height));
    ctx.closePath();
  } else if (tool === "cross") {
    ctx.moveTo(centerX, minY);
    ctx.lineTo(centerX, minY + Math.max(size, height));
    ctx.moveTo(minX, centerY);
    ctx.lineTo(minX + Math.max(size, width), centerY);
  } else {
    ctx.moveTo(minX, minY);
    ctx.lineTo(minX + Math.max(size, width), minY + Math.max(size, height));
    ctx.moveTo(minX + Math.max(size, width), minY);
    ctx.lineTo(minX, minY + Math.max(size, height));
  }
  ctx.stroke();
}

function FaceStickerEditor({
  face,
  onClear,
  onClose,
  onSave,
  sticker,
}: {
  face: CubeFaceSelection;
  onClear: () => void;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
  sticker?: StickerPattern;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [brushSize, setBrushSize] = useState(6);
  const [tool, setTool] = useState<DrawTool>("free");
  const [drawing, setDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [snapshot, setSnapshot] = useState<ImageData | null>(null);

  const prepareContext = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    ctx.strokeStyle = "#20313b";
    return { canvas, ctx };
  }, [brushSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!sticker?.dataUrl) return;
    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = sticker.dataUrl;
  }, [face.index, face.planeId, sticker?.dataUrl]);

  const drawPreset = (nextTool: Exclude<DrawTool, "free">) => {
    const prepared = prepareContext();
    if (!prepared) return;
    const { ctx } = prepared;
    drawStickerShape(ctx, nextTool, { x: 82, y: 82 }, { x: 294, y: 294 });
  };

  const rotateCanvas = (degrees: 90 | -90 | 180) => {
    const prepared = prepareContext();
    if (!prepared) return;
    const { canvas, ctx } = prepared;
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext("2d")?.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(copy, -canvas.width / 2, -canvas.height / 2);
    ctx.restore();
  };

  const clearCanvas = () => {
    const prepared = prepareContext();
    if (!prepared) return;
    const { canvas, ctx } = prepared;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    onClear();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const prepared = prepareContext();
    if (!prepared) return;
    const { canvas, ctx } = prepared;
    const point = getCanvasPoint(canvas, event);
    setDrawing(true);
    setStartPoint(point);
    setSnapshot(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (tool === "free") {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const prepared = prepareContext();
    if (!prepared || !startPoint) return;
    const { canvas, ctx } = prepared;
    const point = getCanvasPoint(canvas, event);
    if (tool === "free") {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      return;
    }
    if (snapshot) ctx.putImageData(snapshot, 0, 0);
    drawStickerShape(ctx, tool, startPoint, point);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    handlePointerMove(event);
    setDrawing(false);
    setStartPoint(null);
    setSnapshot(null);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL("image/png"));
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 30, display: "grid", placeItems: "center", background: "rgba(15,23,42,.18)" }}>
      <div style={{ width: 424, maxWidth: "calc(100vw - 32px)", height: "min(700px, calc(100vh - 24px))", display: "flex", flexDirection: "column", overflow: "hidden", background: "#fff", borderRadius: 8, boxShadow: "0 22px 60px rgba(15,23,42,.28)", padding: "20px 28px 0", position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", right: 14, top: 12, border: 0, background: "transparent", color: "#8a96a5", fontSize: 24, cursor: "pointer" }}>×</button>
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingRight: 30 }}>
            <div style={{ color: "#1f2937", fontSize: 23, fontWeight: 700, marginRight: "auto" }}>
              绘制：【{face.label.replace("面", "")}】面
            </div>
            <button onClick={onClose} style={{ ...editorTopButtonStyle, color: "#475569", background: "#fff", borderColor: "#d7dee9" }}>取消</button>
            <button onClick={clearCanvas} style={{ ...editorTopButtonStyle, color: "#ff4d4f", background: "#fff1f0", borderColor: "#ffccc7" }}>恢复原色</button>
            <button onClick={save} style={{ ...editorTopButtonStyle, color: "#fff", background: "#4096ff", borderColor: "#4096ff" }}>完成贴图</button>
          </div>

          <label style={{ display: "grid", gridTemplateColumns: "76px 1fr 48px", gap: 10, alignItems: "center", color: "#334155", fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
            画笔粗细
            <input type="range" min="2" max="16" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} style={{ accentColor: "#1677ff" }} />
            <span style={{ color: "#2563eb", fontWeight: 800 }}>{brushSize}px</span>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 0, marginBottom: 14 }}>
            {[
              ["line", "直线"],
              ["square", "正方形"],
              ["circle", "圆形"],
              ["triangle", "三角形"],
              ["cross", "十字"],
              ["diagonal", "对角"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => {
                  setTool(value as DrawTool);
                  drawPreset(value as Exclude<DrawTool, "free">);
                }}
                style={{ border: 0, background: tool === value ? "#dbeafe" : "#eef2f7", color: "#334155", height: 34, fontWeight: 700, cursor: "pointer" }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "96px repeat(3,1fr)", gap: 10, alignItems: "center", marginBottom: 14 }}>
            <span style={{ color: "#334155", fontSize: 15, fontWeight: 700 }}>图案方向</span>
            <button onClick={() => rotateCanvas(-90)} style={editorOutlineButtonStyle}>左转90°</button>
            <button onClick={() => rotateCanvas(90)} style={editorOutlineButtonStyle}>右转90°</button>
            <button onClick={() => rotateCanvas(180)} style={editorOutlineButtonStyle}>转180°</button>
          </div>

          <canvas
            ref={canvasRef}
            width={512}
            height={512}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ width: "min(100%, 300px)", height: 300, margin: "0 auto", display: "block", border: "1px dashed #bfdbfe", borderRadius: 8, background: "#f8fafc", touchAction: "none", cursor: "crosshair" }}
          />
          <div style={{ color: "#94a3b8", fontSize: 14, fontWeight: 700, textAlign: "center", margin: "14px 0 0" }}>
            使用鼠标/手指手绘，或点击上方预设图形
          </div>
        </div>

        <div style={{ flexShrink: 0, height: 10 }} />
      </div>
    </div>
  );
}

export function ThreeCubeTool() {
  const [selectedPlane, setSelectedPlane] = useState(1);
  const [cubeTransition, setCubeTransition] = useState<"folded" | "folding" | "unfolded" | "unfolding">("folded");
  const [showGrid, setShowGrid] = useState(true);
  const [showFrame, setShowFrame] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [mode, setMode] = useState<"texture" | "rotate">("texture");
  const [autoSpin, setAutoSpin] = useState(false);
  const [selectedFace, setSelectedFace] = useState<CubeFaceSelection | null>(null);
  const [stickers, setStickers] = useState<Record<string, StickerPattern>>({});

  const activePlane = useMemo(
    () => cubeNetPlanes.find((item) => item.id === selectedPlane) || cubeNetPlanes[0],
    [selectedPlane],
  );
  const foldedFaceLabels = useMemo(() => getFoldedFaceLabels(activePlane), [activePlane]);

  const buildScene = useCallback<SceneBuilder>(
    ({ camera, controls, renderer, scene }) => {
      scene.background = new THREE.Color("#ffffff");
      renderer.setClearColor("#ffffff", 1);
      const mobileScene = (renderer.domElement.parentElement?.clientWidth || window.innerWidth) <= 520;
      const foldedCamera = new THREE.Vector3(0, mobileScene ? 3.7 : 4.8, mobileScene ? 6.0 : 6.6);
      const unfoldedCamera = new THREE.Vector3(0, mobileScene ? 4.5 : 5.9, mobileScene ? 6.8 : 7.7);
      const foldedTarget = new THREE.Vector3(0, mobileScene ? 0.16 : 0.65, 0);
      const unfoldedTarget = new THREE.Vector3(0, mobileScene ? -0.08 : 0, mobileScene ? 0.08 : 0.2);
      camera.fov = 34;
      camera.position.copy(cubeTransition === "folded" ? foldedCamera : unfoldedCamera);
      camera.updateProjectionMatrix();
      controls.target.copy(cubeTransition === "folded" ? foldedTarget : unfoldedTarget);
      controls.enableDamping = true;
      controls.enablePan = true;
      controls.minDistance = 5;
      controls.maxDistance = 12;

      const root = new THREE.Group();
      root.position.set(-0.05, mobileScene ? 0.82 : 0, 0.52);
      scene.add(root);

      if (showGrid) {
        const grid = new THREE.GridHelper(10, 20, "#e2e2e2", "#eeeeee");
        const material = grid.material as THREE.LineBasicMaterial;
        material.transparent = true;
        material.opacity = 0.78;
        grid.position.y = -0.012;
        root.add(grid);
      }

      const yAxis = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 4.2, 0)]),
        new THREE.LineBasicMaterial({ color: "#c12a25" }),
      );
      root.add(yAxis);

      const unit = 0.78;
      const selectable: THREE.Object3D[] = [];
      const minX = Math.min(...activePlane.cells.map((cell) => cell.x));
      const maxX = Math.max(...activePlane.cells.map((cell) => cell.x));
      const minY = Math.min(...activePlane.cells.map((cell) => cell.y));
      const maxY = Math.max(...activePlane.cells.map((cell) => cell.y));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const rootIndex = Math.max(0, activePlane.cells.findIndex((cell) => cell.color === cubeNetColors.yellow));
      const rootCell = activePlane.cells[rootIndex];
      const foldedRootPosition = new THREE.Vector3(0, 0, 0);
      const flatRootPosition = new THREE.Vector3(
        (rootCell.x - centerX) * unit,
        0,
        (rootCell.y - centerY) * unit,
      );
      const keyToIndex = new Map(activePlane.cells.map((cell, index) => [`${cell.x},${cell.y}`, index]));
      const parentIndex = Array<number | null>(activePlane.cells.length).fill(null);
      const visitOrder: number[] = [];
      const queue = [rootIndex];
      const visited = new Set(queue);
      while (queue.length) {
        const currentIndex = queue.shift()!;
        visitOrder.push(currentIndex);
        const cell = activePlane.cells[currentIndex];
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].forEach(([dx, dy]) => {
          const nextIndex = keyToIndex.get(`${cell.x + dx},${cell.y + dy}`);
          if (typeof nextIndex === "number" && !visited.has(nextIndex)) {
            visited.add(nextIndex);
            parentIndex[nextIndex] = currentIndex;
            queue.push(nextIndex);
          }
        });
      }
      activePlane.cells.forEach((_, index) => {
        if (!visited.has(index)) {
          parentIndex[index] = rootIndex;
          visitOrder.push(index);
        }
      });

      const childrenByParent = new Map<number, number[]>();
      parentIndex.forEach((parent, index) => {
        if (typeof parent !== "number") return;
        childrenByParent.set(parent, [...(childrenByParent.get(parent) || []), index]);
      });

      const faceStates: Array<{
        edge: THREE.LineSegments;
        mesh: THREE.Mesh;
        pivot?: THREE.Group;
        foldAngle: number;
        foldAxis: "x" | "z";
        index: number;
      }> = [];
      let rootFaceGroup: THREE.Group | null = null;

      const makeFace = (index: number, parentGroup?: THREE.Group) => {
        const cell = activePlane.cells[index];
        let faceGroup: THREE.Group;
        let pivot: THREE.Group | undefined;
        let foldAxis: "x" | "z" = "z";
        let foldAngle = 0;

        if (!parentGroup) {
          faceGroup = new THREE.Group();
          rootFaceGroup = faceGroup;
          root.add(faceGroup);
        } else {
          const parent = activePlane.cells[parentIndex[index] ?? rootIndex];
          const dx = Math.sign(cell.x - parent.x);
          const dy = Math.sign(cell.y - parent.y);
          pivot = new THREE.Group();
          pivot.position.set(dx * unit * 0.5, 0, dy * unit * 0.5);
          parentGroup.add(pivot);

          faceGroup = new THREE.Group();
          faceGroup.position.set(dx * unit * 0.5, 0, dy * unit * 0.5);
          pivot.add(faceGroup);

          if (dx > 0) {
            foldAxis = "z";
            foldAngle = Math.PI / 2;
          } else if (dx < 0) {
            foldAxis = "z";
            foldAngle = -Math.PI / 2;
          } else if (dy > 0) {
            foldAxis = "x";
            foldAngle = -Math.PI / 2;
          } else {
            foldAxis = "x";
            foldAngle = Math.PI / 2;
          }
        }

        const faceLabel = foldedFaceLabels[index] || faceLabels[index] || `第${index + 1}面`;
        const label = faceLabel.replace("面", "");
        const sticker = stickers[stickerKey(faceLabel)];
        const tile = new THREE.Mesh(
          new THREE.PlaneGeometry(unit, unit),
          new THREE.MeshBasicMaterial({
            map: makeFaceTexture(label, cell.color, selectedFace?.planeId === selectedPlane && selectedFace.index === index, sticker),
            opacity: 0.9,
            side: THREE.DoubleSide,
            transparent: true,
          }),
        );
        tile.rotation.x = -Math.PI / 2;
        tile.position.y = 0.018 + index * 0.001;
        tile.userData.cell = cell;
        tile.userData.faceIndex = index;
        tile.userData.faceLabel = faceLabel;
        selectable.push(tile);
        faceGroup.add(tile);

        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(unit, unit)),
          new THREE.LineBasicMaterial({ color: "#222222" }),
        );
        edge.rotation.copy(tile.rotation);
        edge.position.copy(tile.position);
        faceGroup.add(edge);

        faceStates[index] = {
          edge,
          foldAngle,
          foldAxis,
          index,
          mesh: tile,
          pivot,
        };

        (childrenByParent.get(index) || []).forEach((childIndex) => makeFace(childIndex, faceGroup));
      };

      makeFace(rootIndex);

      if (showFrame) {
        const frame = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(unit, unit, unit)),
          new THREE.LineBasicMaterial({ color: "#222222" }),
        );
        frame.position.set(0, unit / 2, 0);
        root.add(frame);
      }

      const easeInOutCubic = (progress: number) =>
        progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      const setRootPosition = (progress: number) => {
        rootFaceGroup?.position.copy(foldedRootPosition).lerp(flatRootPosition, clampNumber(progress, 0, 1));
      };

      const setFaceAngle = (state: (typeof faceStates)[number], angle: number) => {
        if (!state?.pivot) return;
        if (state.foldAxis === "x") state.pivot.rotation.x = angle;
        if (state.foldAxis === "z") state.pivot.rotation.z = angle;
      };

      const setFoldProgress = (progress: number) => {
        const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        const startCamera = foldedCamera.clone();
        const endCamera = unfoldedCamera.clone();
        const startTarget = foldedTarget.clone();
        const endTarget = unfoldedTarget.clone();
        camera.position.copy(startCamera.lerp(endCamera, eased));
        controls.target.copy(startTarget.lerp(endTarget, eased));
        setRootPosition(eased);
        faceStates.forEach((state) => {
          if (!state) return;
          setFaceAngle(state, state.foldAngle * (1 - eased));
        });
      };

      const setStaggeredFoldProgress = (totalProgress: number, reverse = false) => {
        const cameraProgress = reverse ? 1 - easeInOutCubic(totalProgress) : easeInOutCubic(totalProgress);
        const startCamera = foldedCamera.clone();
        const endCamera = unfoldedCamera.clone();
        const startTarget = foldedTarget.clone();
        const endTarget = unfoldedTarget.clone();
        camera.position.copy(startCamera.lerp(endCamera, cameraProgress));
        controls.target.copy(startTarget.lerp(endTarget, cameraProgress));
        setRootPosition(cameraProgress);

        const faceOrder = visitOrder.filter((index) => index !== rootIndex);
        const orderedFaces = reverse ? [...faceOrder].reverse() : faceOrder;
        const stepDelay = 0.14;
        const faceDuration = 0.36;
        faceStates.forEach((state, index) => {
          if (!state) return;
          if (index === rootIndex) {
            setFaceAngle(state, 0);
            return;
          }
          const orderIndex = orderedFaces.indexOf(index);
          const delay = (orderIndex < 0 ? index : orderIndex) * stepDelay;
          const raw = clampNumber((totalProgress - delay) / faceDuration, 0, 1);
          const faceProgress = easeInOutCubic(raw);
          setFaceAngle(state, reverse ? state.foldAngle * faceProgress : state.foldAngle * (1 - faceProgress));
        });
      };

      if (cubeTransition === "folded" || cubeTransition === "unfolding") setFoldProgress(0);
      if (cubeTransition === "unfolded" || cubeTransition === "folding") setFoldProgress(1);

      let transitionDone = false;
      return {
        animate: (time) => {
          if (cubeTransition === "unfolding" || cubeTransition === "folding") {
            const duration = Math.max(1.8, 4.2 / Math.max(1, speed));
            const amount = Math.min(1, time / duration);
            setStaggeredFoldProgress(amount, cubeTransition === "folding");
            if (!transitionDone && amount >= 1) {
              transitionDone = true;
              window.setTimeout(() => setCubeTransition(cubeTransition === "unfolding" ? "unfolded" : "folded"), 0);
            }
          }
          if (autoSpin) root.rotation.y += 0.0028 * speed;
          if (mode === "rotate") root.rotation.y += 0.0012 * speed;
        },
        onPointerDown: ({ raycaster }) => {
          const hits = raycaster.intersectObjects(selectable, true);
          if (hits[0]?.object.userData.cell) {
            setMode("texture");
            const object = hits[0].object;
            const index = Number(object.userData.faceIndex || 0);
            const cell = object.userData.cell as CubeNetCell;
            setSelectedFace({
              color: cell.color,
              index,
              label: object.userData.faceLabel || faceLabels[index] || `第${index + 1}面`,
              planeId: selectedPlane,
            });
          }
        },
      };
    },
    [activePlane, autoSpin, cubeTransition, foldedFaceLabels, mode, selectedFace, selectedPlane, showFrame, showGrid, speed, stickers],
  );

  const stickerSignature = Object.entries(stickers).map(([key, value]) => `${key}:${value.updatedAt}`).join("|");
  const sceneKey = `cube-${selectedPlane}-${cubeTransition}-${showGrid}-${showFrame}-${mode}-${autoSpin}-${speed}-${selectedFace?.index ?? "none"}-${stickerSignature}`;

  return (
    <section className="three-tool three-cube-tool soft-card overflow-hidden p-0">
      <div className="three-cube-shell" style={{ width: "100%", minHeight: 745, background: "#f3f3f3", padding: "10px 12px 14px", fontFamily: "Microsoft YaHei, PingFang SC, sans-serif" }}>
        <div
          className="cube-net-selector"
          style={{
            alignItems: "flex-start",
            display: "grid",
            gap: 8,
            gridTemplateColumns: "repeat(6,minmax(0,1fr)) 3px repeat(4,minmax(0,1fr)) 3px minmax(0,1fr)",
            marginBottom: 14,
            padding: "0 0 6px",
          }}
        >
          {cubeNetPlanes.map((plane) => (
            <div key={plane.id} style={{ alignItems: "center", display: "contents" }}>
              <button
                onClick={() => {
                  setSelectedPlane(plane.id);
                  setSelectedFace(null);
                  setCubeTransition("unfolding");
                }}
                style={{
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  minHeight: 122,
                  padding: 0,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    background: "#fff1f1",
                    border: "1px solid #ffd8d8",
                    borderRadius: 13,
                    boxShadow: "0 2px 6px rgba(177,30,26,.13)",
                    color: "#d00000",
                    display: "inline-flex",
                    fontSize: 14,
                    fontWeight: 700,
                    justifyContent: "center",
                    lineHeight: "26px",
                    minWidth: 64,
                    padding: "0 7px",
                  }}
                >
                  {plane.type}
                </div>
                <div
                  style={{
                    background: "linear-gradient(180deg,#c81919,#a80f0f)",
                    borderRadius: 6,
                    boxShadow: "0 4px 10px rgba(177,30,26,.24)",
                    color: "#ffffff",
                    fontSize: 16,
                    fontWeight: 700,
                    height: 40,
                    lineHeight: "40px",
                    margin: "8px auto 0",
                    width: 72,
                  }}
                >
                  平面{plane.id}
                </div>
                <CubeNetThumbnail cells={plane.cells} />
              </button>
              {plane.id === 6 && <div style={{ background: "#9b1515", height: 74, margin: "6px 0 0", width: 3 }} />}
              {plane.id === 10 && <div style={{ background: "#9b1515", height: 74, margin: "6px 0 0", width: 3 }} />}
            </div>
          ))}
        </div>

        <div className="cube-scene" style={{ position: "relative", background: "#fff", borderRadius: 8, overflow: "hidden", boxShadow: "0 3px 14px rgba(0,0,0,.08)" }}>
          <div className="cube-scene-toolbar" style={{ position: "absolute", top: 16, left: 12, right: 12, zIndex: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div className="cube-toolbar-group" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button style={redMainButtonStyle} onClick={() => setShowGrid((value) => !value)}>{showGrid ? "隐藏网格" : "显示网格"}</button>
              <button style={redMainButtonStyle} onClick={() => setShowFrame((value) => !value)}>{showFrame ? "隐藏框架" : "显示框架"}</button>
              <label style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: 0, padding: "6px 0", fontSize: 14, color: "#666", fontWeight: 500 }}>
                展开速度: {speed}x
                <input type="range" min="1" max="5" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} style={{ width: 92, accentColor: "#b11e1a" }} />
              </label>
            </div>
            <div className="cube-toolbar-group" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ display: "flex", background: "#e9ecef", border: "1px solid #d7dbe0", borderRadius: 999, padding: 4, boxShadow: "0 4px 15px rgba(0,0,0,.14)" }}>
                <button style={mode === "texture" ? toggleActiveStyle : toggleButtonStyle} onClick={() => setMode("texture")}>贴图模式</button>
                <button style={mode === "rotate" ? toggleActiveStyle : toggleButtonStyle} onClick={() => setMode("rotate")}>旋转模式</button>
              </div>
              <button style={glassButtonStyle} onClick={() => setAutoSpin((value) => !value)}>{autoSpin ? "关闭旋转" : "开启旋转"}</button>
              <button
                style={{ ...glassButtonStyle, background: "#b11e1a", color: "#fff", borderColor: "#b11e1a" }}
                onClick={() => {
                  setCubeTransition("folding");
                  setShowGrid(true);
                  setShowFrame(true);
                  setMode("texture");
                  setAutoSpin(false);
                  setSelectedFace(null);
                  setSpeed(1);
                }}
              >
                刷新
              </button>
            </div>
          </div>

          <div className="cube-axis-label" style={{ color: "#b11e1a", fontSize: 20, fontWeight: 500, left: "50%", lineHeight: 1, position: "absolute", top: 18, transform: "translateX(-50%)", zIndex: 9 }}>
            Y
          </div>
          <div className="cube-status-pill" style={{ position: "absolute", left: 16, bottom: 16, zIndex: 10, borderRadius: 999, background: "rgba(255,255,255,.92)", border: "1px solid #d7dbe0", color: "#4b5563", fontSize: 12, fontWeight: 700, padding: "7px 12px", boxShadow: "0 4px 15px rgba(0,0,0,.1)" }}>
            {mode === "texture" ? (selectedFace ? `已选：${selectedFace.label}，再次点击面可重画` : "贴图模式：点击正方体任意面") : "旋转模式：拖拽观察立方体"}
          </div>
          {showGrid && <div className="cube-axis-line" style={{ background: "#d42a27", height: 310, left: "50%", position: "absolute", top: 60, transform: "translateX(-50%)", width: 1, zIndex: 8 }} />}
          <ThreeStage buildScene={buildScene} sceneKey={sceneKey} />
          {mode === "texture" && selectedFace && (
            <FaceStickerEditor
              face={selectedFace}
              sticker={stickers[stickerKey(selectedFace.label)]}
              onClose={() => setSelectedFace(null)}
              onClear={() => {
                setStickers((current) => {
                  const next = { ...current };
                  delete next[stickerKey(selectedFace.label)];
                  return next;
                });
              }}
              onSave={(dataUrl) => {
                setStickers((current) => ({
                  ...current,
                  [stickerKey(selectedFace.label)]: {
                    dataUrl,
                    updatedAt: Date.now(),
                  },
                }));
                setSelectedFace(null);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

const initialBlocks: Block3D[] = [
  { id: "b1", x: 0, y: 0, z: 0, color: "#4f7fc7" },
  { id: "b2", x: 1, y: 0, z: 0, color: "#3f8f78" },
  { id: "b3", x: 0, y: 1, z: 0, color: "#e56f4e" },
  { id: "b4", x: 0, y: 0, z: 1, color: "#f4d06f" },
];

function normalizeBlocks(blocks: Block3D[]) {
  const minX = Math.min(...blocks.map((block) => block.x));
  const minY = Math.min(...blocks.map((block) => block.y));
  const minZ = Math.min(...blocks.map((block) => block.z));
  return blocks.map((block) => ({
    ...block,
    x: block.x - minX,
    y: block.y - minY,
    z: block.z - minZ,
  }));
}

function blockKey(block: Pick<Block3D, "x" | "y" | "z">) {
  return `${block.x},${block.y},${block.z}`;
}

function getProjection(blocks: Block3D[], view: "front" | "left" | "top") {
  const cells = new Set<string>();
  blocks.forEach((block) => {
    if (view === "front") cells.add(`${block.x},${block.y}`);
    if (view === "left") cells.add(`${block.z},${block.y}`);
    if (view === "top") cells.add(`${block.x},${block.z}`);
  });
  return cells;
}

function rotateBlocks(blocks: Block3D[], axis: "x" | "y" | "z") {
  const rotated = blocks.map((block) => {
    if (axis === "y") return { ...block, x: -block.z, z: block.x };
    if (axis === "x") return { ...block, y: -block.z, z: block.y };
    return { ...block, x: -block.y, y: block.x };
  });
  return normalizeBlocks(rotated);
}

function moveBlock(block: Block3D, direction: string) {
  const next = { ...block };
  if (direction === "左移-X") next.x -= 1;
  if (direction === "右移+X") next.x += 1;
  if (direction === "前移+Z") next.z += 1;
  if (direction === "后移-Z") next.z -= 1;
  if (direction === "上移+Y") next.y += 1;
  if (direction === "下移-Y") next.y -= 1;
  return next;
}

const cubeFaceTransforms = [
  "translateZ(30px)",
  "translateZ(-30px) rotateY(180deg)",
  "translateX(30px) rotateY(90deg)",
  "translateX(-30px) rotateY(-90deg)",
  "translateY(-30px) rotateX(90deg)",
  "translateY(30px) rotateX(-90deg)",
];

const faceVectors = [
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
];

function makeCssBlockStyle(block: Block3D): CSSProperties {
  return {
    transform: `translate3d(${block.x * 60}px, ${-block.y * 60}px, ${block.z * 60}px)`,
  };
}

function makeCssFaceStyle(color: string, faceIndex: number): CSSProperties {
  const brightness = [1.05, 0.9, 0.85, 0.95, 1.15, 0.8][faceIndex];
  return {
    backgroundColor: color,
    filter: `brightness(${brightness})`,
    transform: cubeFaceTransforms[faceIndex],
  };
}

function useSpatialDrag() {
  const [rx, setRx] = useState(-35);
  const [ry, setRy] = useState(-45);
  const [scale, setScale] = useState(1.2);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<null | { x: number; y: number; rx: number; ry: number; panX: number; panY: number; panning: boolean }>(null);
  const [panning, setPanning] = useState(false);

  const worldStyle: CSSProperties = {
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) rotateX(${rx}deg) rotateY(${ry}deg) scale3d(${scale}, ${scale}, ${scale})`,
  };

  return {
    panning,
    scale,
    setScale,
    setPan,
    setRx,
    setRy,
    worldStyle,
    handlers: {
      onMouseDown(event: React.MouseEvent<HTMLDivElement>) {
        setDragState({ x: event.clientX, y: event.clientY, rx, ry, panX: pan.x, panY: pan.y, panning: event.button === 2 });
        setPanning(event.button === 2);
      },
      onMouseMove(event: React.MouseEvent<HTMLDivElement>) {
        if (!dragState) return;
        const dx = event.clientX - dragState.x;
        const dy = event.clientY - dragState.y;
        if (dragState.panning) {
          setPan({ x: dragState.panX + dx * 1.2, y: dragState.panY + dy * 1.2 });
          return;
        }
        setRy(dragState.ry + dx * 0.6);
        setRx(Math.max(-89, Math.min(89, dragState.rx - dy * 0.6)));
      },
      onMouseUp() {
        setDragState(null);
        setPanning(false);
      },
      onWheel(event: React.WheelEvent<HTMLDivElement>) {
        event.preventDefault();
        setScale((value) => Math.max(0.35, Math.min(4, value + (event.deltaY > 0 ? -0.16 : 0.16))));
      },
      onContextMenu(event: React.MouseEvent<HTMLDivElement>) {
        event.preventDefault();
      },
    },
  };
}

export function ThreeBlocksTool({ viewsOnly = false }: { viewsOnly?: boolean }) {
  const [blocks, setBlocks] = useState<Block3D[]>(viewsOnly ? [{ id: "b1", x: 0, y: 0, z: 0, color: "#333333" }] : initialBlocks);
  const [selectedId, setSelectedId] = useState<string | null>(viewsOnly ? null : "b1");
  const [color, setColor] = useState(viewsOnly ? "#333333" : "#ffffff");
  const [showGrid, setShowGrid] = useState(true);
  const [multiSelect, setMultiSelect] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [merged, setMerged] = useState(true);
  const [toast, setToast] = useState("");
  const drag = useSpatialDrag();

  const selected = selectedId ? blocks.find((block) => block.id === selectedId) || null : null;
  const occupied = useMemo(() => new Set(blocks.map(blockKey)), [blocks]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1500);
  };

  const addBlockAt = (next: Omit<Block3D, "id" | "color">) => {
    if (next.x < 0 || next.y < 0 || next.z < 0 || occupied.has(blockKey(next))) {
      showToast(next.x < 0 || next.y < 0 || next.z < 0 ? "移动遇障碍" : "此处有积木");
      return;
    }
    const id = `b-${Date.now()}`;
    setBlocks((items) => [...items, { ...next, id, color }]);
    setSelectedId(id);
  };

  const addAdjacent = (faceIndex = 2) => {
    const anchor = selected || blocks[0];
    const vector = faceVectors[faceIndex];
    addBlockAt({ x: anchor.x + vector.x, y: anchor.y + vector.y, z: anchor.z + vector.z });
  };

  const moveSelection = (direction: string) => {
    const moving = merged ? blocks : blocks.filter((block) => block.id === selectedId);
    const fixed = merged ? [] : blocks.filter((block) => block.id !== selectedId);
    const moved = moving.map((block) => moveBlock(block, direction));
    const fixedKeys = new Set(fixed.map(blockKey));
    if (moved.some((block) => block.x < 0 || block.y < 0 || block.z < 0 || fixedKeys.has(blockKey(block)))) {
      showToast("移动遇障碍");
      return;
    }
    setBlocks(normalizeBlocks([...fixed, ...moved]));
  };

  const rotateSelection = (axis: "x" | "y" | "z") => {
    setBlocks((items) => rotateBlocks(items, axis));
    showToast(axis === "x" ? "转X轴" : axis === "y" ? "转Y轴" : "转Z轴");
  };

  const deleteSelected = () => {
    if (!selectedId) {
      showToast("请选中积木进行操作");
      return;
    }
    if (blocks.length <= 1) {
      showToast("考试要求至少保留一块");
      return;
    }
    const next = blocks.filter((block) => block.id !== selectedId);
    setBlocks(next);
    setSelectedId(next[0]?.id || null);
  };

  const resetView = () => {
    drag.setRx(-35);
    drag.setRy(viewsOnly ? 45 : -45);
    drag.setScale(viewsOnly ? 1 : 1.2);
    drag.setPan({ x: 0, y: viewsOnly ? 40 : 0 });
  };

  const setView = (view: "front" | "top" | "left") => {
    setShowGrid(false);
    drag.setPan({ x: 0, y: viewsOnly ? 40 : 0 });
    if (view === "front") {
      drag.setRx(0);
      drag.setRy(0);
    } else if (view === "top") {
      drag.setRx(-90);
      drag.setRy(0);
    } else {
      drag.setRx(0);
      drag.setRy(90);
    }
  };

  const resetAll = () => {
    setBlocks(viewsOnly ? [{ id: "b1", x: 0, y: 0, z: 0, color: "#333333" }] : initialBlocks);
    setSelectedId(viewsOnly ? null : "b1");
    setShowGrid(true);
    resetView();
    showToast("已回正中心");
  };

  const rootClass = viewsOnly ? "sst-original" : "ph-original";

  return (
    <section className="three-tool three-blocks-tool soft-card overflow-hidden p-0">
      <div
        className={`${rootClass} three-blocks-shell`}
        style={{
          height: viewsOnly ? "min(760px, calc(100vh - 118px))" : "min(720px, calc(100vh - 118px))",
          minHeight: 560,
          display: "flex",
          flexDirection: "column",
          background: "#f4f6f9",
          overflow: "hidden",
          position: "relative",
          userSelect: "none",
        }}
      >
        {toast && (
          <div
            style={{
              position: "absolute",
              top: viewsOnly ? "40%" : 40,
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "rgba(0,0,0,0.72)",
              color: "#fff",
              padding: "10px 18px",
              borderRadius: 8,
              fontSize: 13,
              zIndex: 80,
            }}
          >
            {toast}
          </div>
        )}
        <div
          {...drag.handlers}
          className="three-blocks-stage"
          style={{
            flex: 1,
            position: "relative",
            perspective: viewsOnly ? 2500 : 1800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: viewsOnly ? "radial-gradient(circle at 50% 50%, #eaeff4, #d1dae3)" : "radial-gradient(circle at 50% 50%, #e8edf3, #c4d0dc)",
            overflow: "hidden",
            cursor: drag.panning ? "grabbing" : "grab",
          }}
          onClick={() => {
            if (!viewsOnly) return;
            setSelectedId(null);
          }}
        >
          <div
            style={{
              width: 0,
              height: 0,
              transformStyle: "preserve-3d",
              transformOrigin: "center center",
              transition: "transform .4s cubic-bezier(.25,1,.5,1)",
              ...drag.worldStyle,
            }}
          >
            {showGrid && (
              <div
                style={{
                  position: "absolute",
                  width: viewsOnly ? 2000 : 4000,
                  height: viewsOnly ? 2000 : 4000,
                  left: viewsOnly ? -1000 : -2000,
                  top: viewsOnly ? -1000 : -2000,
                  transform: "translateY(30px) rotateX(90deg)",
                  pointerEvents: "none",
                  transformStyle: "preserve-3d",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    backgroundImage:
                      "linear-gradient(rgba(100,100,100,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(100,100,100,.14) 1px, transparent 1px)",
                    backgroundSize: "60px 60px",
                    backgroundPosition: "center center",
                    maskImage: "radial-gradient(circle at 50% 50%, white 12%, transparent 62%)",
                  }}
                />
                {viewsOnly && (
                  <>
                    <div style={{ position: "absolute", left: 1000, top: 1300, transform: "translate(-50%,-50%)", color: "#fff", background: "rgba(0,122,255,.7)", padding: "6px 14px", borderRadius: 20, fontSize: 15, fontWeight: 700 }}>主视方向 ↑</div>
                    <div style={{ position: "absolute", left: 700, top: 1000, transform: "translate(-50%,-50%) rotate(90deg)", color: "#fff", background: "rgba(0,122,255,.7)", padding: "6px 14px", borderRadius: 20, fontSize: 15, fontWeight: 700 }}>左视方向 ↑</div>
                  </>
                )}
                {!viewsOnly &&
                  Array.from({ length: 6 }).flatMap((_, idx) => {
                    const distance = (idx + 1) * 300;
                    return [
                      { id: `px-${distance}`, x: 2000 + distance, z: 2000, label: "+X", color: "#ff3b30" },
                      { id: `nx-${distance}`, x: 2000 - distance, z: 2000, label: "-X", color: "#ff3b30" },
                      { id: `pz-${distance}`, x: 2000, z: 2000 + distance, label: "+Z", color: "#007aff" },
                      { id: `nz-${distance}`, x: 2000, z: 2000 - distance, label: "-Z", color: "#007aff" },
                    ];
                  }).map((mark) => (
                    <div key={mark.id} style={{ position: "absolute", left: mark.x, top: mark.z, color: mark.color, fontWeight: 700, fontSize: 14, background: "rgba(255,255,255,.7)", padding: "1px 4px", borderRadius: 4, transform: "translate(-50%,-50%) rotateX(-90deg)" }}>
                      {mark.label}
                    </div>
                  ))}
              </div>
            )}

            {blocks.map((block) => {
              const selectedBlock = block.id === selectedId;
              return (
                <div
                  key={block.id}
                  style={{
                    position: "absolute",
                    width: 60,
                    height: 60,
                    left: -30,
                    top: -30,
                    transformStyle: "preserve-3d",
                    cursor: selectedBlock ? "move" : "pointer",
                    ...makeCssBlockStyle(block),
                  }}
                >
                  {cubeFaceTransforms.map((_, faceIndex) => (
                    <div
                      key={faceIndex}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (selectedBlock) {
                          addAdjacent(faceIndex);
                        } else {
                          setSelectedId(block.id);
                        }
                      }}
                      style={{
                        position: "absolute",
                        width: "100%",
                        height: "100%",
                        border: selectedBlock ? "2px solid #007aff" : viewsOnly ? "1px solid #8e9ba8" : "1px solid #555",
                        boxSizing: "border-box",
                        boxShadow: selectedBlock ? "inset 0 0 15px rgba(0,122,255,.4), 0 0 5px rgba(0,122,255,.5)" : "inset 0 0 14px rgba(0,0,0,.12)",
                        transition: "filter .2s",
                        ...makeCssFaceStyle(block.color, faceIndex),
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          <div
            style={{
              position: "absolute",
              top: viewsOnly ? 20 : 15,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(255,255,255,.9)",
              color: "#333",
              padding: viewsOnly ? "10px 20px" : "6px 14px",
              borderRadius: 20,
              fontSize: viewsOnly ? 14 : 12,
              fontWeight: viewsOnly ? 500 : 700,
              pointerEvents: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,.08)",
              whiteSpace: "nowrap",
            }}
          >
            {drag.panning ? "🖐 平移模式：拖拽移动空间" : viewsOnly ? "💡 点击选中 · 选面添加 · 长按/右键平移 · 滚轮缩放" : multiSelect ? "📦 多选模式：可点选多个组合进行合并" : "💡 点选选中，长按可直接拖动，点面可添加独立积木"}
          </div>

          <div className="three-blocks-zoom" style={{ position: "absolute", right: viewsOnly ? 20 : 15, bottom: viewsOnly ? 25 : panelOpen ? 174 : 76, display: "flex", flexDirection: viewsOnly ? "column" : "row", gap: viewsOnly ? 12 : 8, zIndex: 20, transition: "bottom .3s" }}>
            <button onClick={() => drag.setScale((value) => Math.max(0.35, value - 0.2))} style={zoomButtonStyle}>-</button>
            <button onClick={() => drag.setScale((value) => Math.min(4, value + 0.2))} style={zoomButtonStyle}>+</button>
          </div>
        </div>

        <div
          className="three-blocks-panel"
          style={{
            background: "#fff",
            borderRadius: viewsOnly ? "24px 24px 0 0" : "16px 16px 0 0",
            padding: viewsOnly ? "24px 16px 30px" : "10px 12px 12px",
            boxShadow: "0 -4px 20px rgba(0,0,0,.08)",
            zIndex: 10,
          }}
        >
          <div className="three-blocks-panel-inner" style={{ maxWidth: viewsOnly ? 680 : "none", margin: "0 auto", display: "flex", flexDirection: "column", gap: viewsOnly ? 22 : 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px" }}>
              <div style={{ fontSize: viewsOnly ? 15 : 13, color: selectedId ? "#007aff" : "#999", fontWeight: selectedId ? 700 : 500 }}>
                {selectedId ? "已选中积木 (可添加/删除)" : "请选中积木进行操作"}
              </div>
              <div style={{ display: "flex", gap: viewsOnly ? 12 : 6 }}>
                {["#333333", "#999999", "#ffffff", "#ff3b30", "#007aff", "#ffcc00"].map((item) => (
                  <button
                    key={item}
                    onClick={() => setColor(item)}
                    style={{
                      width: viewsOnly ? 26 : 20,
                      height: viewsOnly ? 26 : 20,
                      borderRadius: "50%",
                      border: color === item ? "2px solid #007aff" : "2px solid #eaeaea",
                      transform: color === item ? "scale(1.25)" : "scale(1)",
                      background: item,
                      boxShadow: color === item ? "0 3px 8px rgba(0,0,0,.15)" : "none",
                    }}
                  />
                ))}
              </div>
              {!viewsOnly && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setMultiSelect((value) => !value)} style={{ ...smallModeButtonStyle, background: multiSelect ? "#e0efff" : "#f0f2f5", color: multiSelect ? "#007aff" : "#333" }}>{multiSelect ? "关多选" : "开多选"}</button>
                  <button onClick={() => setPanelOpen((value) => !value)} style={{ ...smallModeButtonStyle, background: "#fff", border: "1px solid #e5e7eb" }}>{panelOpen ? "收起 ⬇" : "展开 ⬆"}</button>
                </div>
              )}
            </div>

            {viewsOnly ? (
              <>
                <div style={{ display: "flex", gap: 12 }}>
                  <PanelButton onClick={() => setView("front")}>主视图</PanelButton>
                  <PanelButton onClick={() => setView("top")}>俯视图</PanelButton>
                  <PanelButton onClick={() => setView("left")}>左视图</PanelButton>
                  <PanelButton onClick={() => setShowGrid((value) => !value)}>{showGrid ? "关坐标" : "开坐标"}</PanelButton>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <PanelButton danger disabled={!selectedId} onClick={deleteSelected}>删积木</PanelButton>
                  <PanelButton primary onClick={() => showToast("已回正中心")}>居中</PanelButton>
                  <PanelButton onClick={resetAll}>初始</PanelButton>
                  <PanelButton green onClick={resetView}>视角</PanelButton>
                </div>
              </>
            ) : (
              panelOpen && (
                <>
                  <div style={{ display: "flex", gap: 6 }}>
                    <MiniButton tone="green" onClick={() => addAdjacent(2)}>新建</MiniButton>
                    <MiniButton onClick={() => setSelectedId(blocks[0]?.id || null)}>全选</MiniButton>
                    <MiniButton onClick={() => (setBlocks([]), setSelectedId(null), showToast("已清空"))}>清空</MiniButton>
                    <MiniButton tone="blue" onClick={() => showToast("已回正中心")}>居中</MiniButton>
                    <MiniButton tone="blue" onClick={() => (setMerged((value) => !value), showToast(merged ? "组合已拆解" : "已合并整体"))}>{merged ? "解散" : "合并"}</MiniButton>
                    <MiniButton tone="red" onClick={deleteSelected}>删除</MiniButton>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, background: "#f8fafc", padding: 6, borderRadius: 8 }}>
                    <MiniButton onClick={() => moveSelection("左移-X")}>左移-X</MiniButton>
                    <MiniButton tone="blue" onClick={() => rotateSelection("x")}>转X轴</MiniButton>
                    <MiniButton onClick={() => moveSelection("右移+X")}>右移+X</MiniButton>
                    <MiniButton onClick={() => moveSelection("前移+Z")}>前移+Z</MiniButton>
                    <MiniButton tone="blue" onClick={() => rotateSelection("z")}>转Z轴</MiniButton>
                    <MiniButton onClick={() => moveSelection("后移-Z")}>后移-Z</MiniButton>
                    <MiniButton onClick={() => moveSelection("上移+Y")}>上移+Y</MiniButton>
                    <MiniButton tone="blue" onClick={() => rotateSelection("y")}>转Y轴</MiniButton>
                    <MiniButton onClick={() => moveSelection("下移-Y")}>下移-Y</MiniButton>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const zoomButtonStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: "50%",
  background: "rgba(255,255,255,.9)",
  boxShadow: "0 2px 10px rgba(0,0,0,.15)",
  fontSize: 22,
  color: "#333",
  border: "none",
};

const smallModeButtonStyle: CSSProperties = {
  height: 28,
  lineHeight: "28px",
  fontSize: 12,
  borderRadius: 14,
  padding: "0 12px",
  border: "none",
  fontWeight: 700,
};

function MiniButton({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone?: "green" | "blue" | "red" }) {
  const toneStyle =
    tone === "green"
      ? { background: "#34c759", color: "#fff" }
      : tone === "blue"
        ? { background: "#007aff", color: "#fff" }
        : tone === "red"
          ? { background: "#ff3b30", color: "#fff" }
          : { background: "#fff", color: "#007aff", border: "1px solid #d1e5fb" };
  return (
    <button onClick={onClick} style={{ flex: 1, height: 32, borderRadius: 6, fontSize: 12, fontWeight: 700, border: "none", ...toneStyle }}>
      {children}
    </button>
  );
}

function PanelButton({
  children,
  danger,
  disabled,
  green,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  green?: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: 1,
        height: 46,
        borderRadius: 12,
        border: "none",
        fontSize: 15,
        fontWeight: 500,
        background: danger ? (disabled ? "#ffccc7" : "#ff4d4f") : primary ? "#1677ff" : green ? "#52c41a" : "#f0f4f8",
        color: danger || primary || green ? "#fff" : "#333",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

const cutGeometryOptions = [
  { id: "cube", title: "正方体", short: "方", desc: "棱长相等，常考三角形、矩形、五边形、六边形截面。" },
  { id: "cuboid", title: "长方体", short: "长", desc: "判断时先看切面是否平行于某组相对面。" },
  { id: "sphere", title: "球体", short: "球", desc: "任意平面截球都是圆，离球心越远截圆越小。" },
  { id: "cylinder", title: "圆柱", short: "柱", desc: "平切是圆，竖切是矩形，斜切常表现为椭圆。" },
  { id: "cone", title: "圆锥", short: "锥", desc: "平切是圆，过顶点可得到三角形截面。" },
  { id: "frustum", title: "圆台", short: "台", desc: "平切是圆，竖切常得到梯形。" },
] as const;

type CutGeometry = (typeof cutGeometryOptions)[number]["id"];
type SectionPreview = "circle" | "ellipse" | "hexagon" | "pentagon" | "rectangle" | "trapezoid" | "triangle";

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function makeCutGeometry(kind: CutGeometry) {
  if (kind === "cuboid") return new THREE.BoxGeometry(3.6, 2.3, 2.8);
  if (kind === "sphere") return new THREE.SphereGeometry(1.55, 64, 32);
  if (kind === "cylinder") return new THREE.CylinderGeometry(1.2, 1.2, 3.2, 64, 1);
  if (kind === "cone") return new THREE.ConeGeometry(1.55, 3.2, 64);
  if (kind === "frustum") return new THREE.CylinderGeometry(0.78, 1.55, 3.1, 64, 1);
  return new THREE.BoxGeometry(2.8, 2.8, 2.8);
}

function makeCutNormal(angleX: number, angleY: number, angleZ: number, keepNegative = false) {
  const normal = new THREE.Vector3(0, 1, 0)
    .applyEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(angleX),
        THREE.MathUtils.degToRad(angleY),
        THREE.MathUtils.degToRad(angleZ),
        "XYZ",
      ),
    )
    .normalize();
  return keepNegative ? normal.negate() : normal;
}

function deriveSectionInfo(kind: CutGeometry, normal: THREE.Vector3, offset: number): { desc: string; preview: SectionPreview; title: string } {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  const dominant = Math.max(ax, ay, az);

  if (kind === "sphere") {
    return {
      title: dominant > 0.94 ? "圆形截面" : "圆形截面（斜视为椭圆）",
      preview: dominant > 0.94 ? "circle" : "ellipse",
      desc: "球体被平面截开一定是圆；调节移动量可以观察截圆由大到小。",
    };
  }

  if (kind === "cylinder") {
    if (ay > 0.9) return { title: "圆形截面", preview: "circle", desc: "切面近似垂直于圆柱轴线，截面为圆。" };
    if (ay < 0.22) return { title: "矩形截面", preview: "rectangle", desc: "切面近似经过圆柱轴线，展开观察常见为矩形。" };
    return { title: "椭圆截面", preview: "ellipse", desc: "斜切圆柱时，考试图形中常表现为椭圆。" };
  }

  if (kind === "cone") {
    if (ay > 0.88) return { title: "圆形截面", preview: "circle", desc: "切面平行于底面时截面为圆。" };
    if (Math.abs(offset) > 0.95) return { title: "三角形截面", preview: "triangle", desc: "切面靠近并穿过顶点方向时，常得到三角形截面。" };
    return { title: "椭圆截面", preview: "ellipse", desc: "普通斜切圆锥时，截线多表现为椭圆或抛物线类曲线。" };
  }

  if (kind === "frustum") {
    if (ay > 0.9) return { title: "圆形截面", preview: "circle", desc: "圆台被平行底面的平面截开，截面为圆。" };
    if (ay < 0.25) return { title: "梯形截面", preview: "trapezoid", desc: "圆台竖切时，典型截面是等腰梯形。" };
    return { title: "椭圆截面", preview: "ellipse", desc: "斜切圆台时，截线通常呈椭圆类曲线。" };
  }

  if (dominant > 0.92) {
    return { title: kind === "cube" ? "正方形/矩形截面" : "矩形截面", preview: "rectangle", desc: "切面与某组面近似平行，优先判断为矩形类截面。" };
  }
  if (Math.abs(offset) > 1.08) {
    return { title: "三角形截面", preview: "triangle", desc: "切面只切到相邻三条棱附近时，截面通常是三角形。" };
  }
  if (dominant < 0.58) {
    return { title: "六边形截面", preview: "hexagon", desc: "斜切同时经过六个面时，容易形成六边形截面。" };
  }
  return { title: "五边形/梯形截面", preview: "pentagon", desc: "斜切但没有同时切到六个面时，常见五边形或梯形类截面。" };
}

function makeSectionPreviewGeometry(preview: SectionPreview) {
  if (preview === "circle") return new THREE.CircleGeometry(0.9, 72);
  if (preview === "ellipse") {
    const geometry = new THREE.CircleGeometry(0.9, 72);
    geometry.scale(1.38, 0.62, 1);
    return geometry;
  }
  if (preview === "rectangle") {
    const shape = new THREE.Shape([
      new THREE.Vector2(-1.1, -0.68),
      new THREE.Vector2(1.1, -0.68),
      new THREE.Vector2(1.1, 0.68),
      new THREE.Vector2(-1.1, 0.68),
    ]);
    return new THREE.ShapeGeometry(shape);
  }
  if (preview === "trapezoid") {
    const shape = new THREE.Shape([
      new THREE.Vector2(-1.2, -0.72),
      new THREE.Vector2(1.2, -0.72),
      new THREE.Vector2(0.72, 0.72),
      new THREE.Vector2(-0.72, 0.72),
    ]);
    return new THREE.ShapeGeometry(shape);
  }
  const sides = preview === "triangle" ? 3 : preview === "pentagon" ? 5 : 6;
  return new THREE.ShapeGeometry(new THREE.Shape(makeSectionPoints(sides, preview === "triangle" ? 0.95 : 1)));
}

export function ThreeCutTool() {
  const [geometryKind, setGeometryKind] = useState<CutGeometry>("cube");
  const [operation, setOperation] = useState<"move" | "rotate" | "scale">("rotate");
  const [angleX, setAngleX] = useState(28);
  const [angleY, setAngleY] = useState(-18);
  const [angleZ, setAngleZ] = useState(0);
  const [offset, setOffset] = useState(0);
  const [planeSize, setPlaneSize] = useState(4.4);
  const [solidOpacity, setSolidOpacity] = useState(56);
  const [hollowMode, setHollowMode] = useState<"center" | "off" | "tunnel">("off");
  const [hollowSize, setHollowSize] = useState(48);
  const [cutEnabled, setCutEnabled] = useState(true);
  const [showPlane, setShowPlane] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [keepNegative, setKeepNegative] = useState(false);
  const [spin, setSpin] = useState(false);
  const [geometryColor, setGeometryColor] = useState("#d7ecff");
  const [planeColor, setPlaneColor] = useState("#e34a44");
  const [sectionColor, setSectionColor] = useState("#f2b84b");
  const [helperColor, setHelperColor] = useState("#1f2937");
  const [directEdit, setDirectEdit] = useState(true);
  const [draggingPlane, setDraggingPlane] = useState(false);
  const planeDragRef = useRef<null | {
    angleX: number;
    angleY: number;
    offset: number;
    planeSize: number;
    x: number;
    y: number;
  }>(null);

  const normal = useMemo(() => makeCutNormal(angleX, angleY, angleZ, keepNegative), [angleX, angleY, angleZ, keepNegative]);
  const sectionInfo = useMemo(() => deriveSectionInfo(geometryKind, normal, offset), [geometryKind, normal, offset]);
  const currentGeometry = cutGeometryOptions.find((item) => item.id === geometryKind) || cutGeometryOptions[0];

  const resetCut = () => {
    setAngleX(28);
    setAngleY(-18);
    setAngleZ(0);
    setOffset(0);
    setPlaneSize(4.4);
    setCutEnabled(true);
    setShowPlane(true);
    setKeepNegative(false);
  };

  const setCutDirection = (direction: "front" | "horizontal" | "side" | "slant") => {
    if (direction === "horizontal") {
      setAngleX(0);
      setAngleY(0);
      setAngleZ(0);
    }
    if (direction === "front") {
      setAngleX(90);
      setAngleY(0);
      setAngleZ(0);
    }
    if (direction === "side") {
      setAngleX(0);
      setAngleY(0);
      setAngleZ(-90);
    }
    if (direction === "slant") {
      setAngleX(28);
      setAngleY(-18);
      setAngleZ(0);
    }
  };

  const nudgeCutDirection = (axis: "x" | "y" | "z", delta: number) => {
    if (axis === "x") setAngleX((value) => clampNumber(value + delta, -80, 80));
    if (axis === "y") setAngleY((value) => clampNumber(value + delta, -80, 80));
    if (axis === "z") setAngleZ((value) => clampNumber(value + delta, -80, 80));
  };

  const startPlaneDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!directEdit || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    planeDragRef.current = { angleX, angleY, offset, planeSize, x: event.clientX, y: event.clientY };
    setDraggingPlane(true);
  };

  const movePlaneDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = planeDragRef.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (operation === "move") {
      setOffset(clampNumber(start.offset - dy * 0.01, -1.55, 1.55));
    }
    if (operation === "rotate") {
      setAngleX(clampNumber(start.angleX + dy * 0.35, -80, 80));
      setAngleY(clampNumber(start.angleY + dx * 0.35, -80, 80));
    }
    if (operation === "scale") {
      setPlaneSize(clampNumber(start.planeSize + (dx - dy) * 0.012, 2.4, 6.4));
    }
  };

  const stopPlaneDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!planeDragRef.current) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released if the browser cancels the drag.
    }
    planeDragRef.current = null;
    setDraggingPlane(false);
  };

  const buildScene = useCallback<SceneBuilder>(
    ({ camera, controls, renderer, scene }) => {
      scene.background = new THREE.Color("#f6f7f8");
      renderer.setClearColor("#f6f7f8", 1);
      renderer.localClippingEnabled = cutEnabled;
      camera.position.set(5.2, 4.4, 6.2);
      controls.target.set(0, 0, 0);
      controls.enableDamping = true;
      controls.minDistance = 3.8;
      controls.maxDistance = 12;

      const root = new THREE.Group();
      scene.add(root);

      if (showAxes) {
        const grid = new THREE.GridHelper(8, 16, "#d8dde3", "#e8ebef");
        const gridMaterial = grid.material as THREE.LineBasicMaterial;
        gridMaterial.transparent = true;
        gridMaterial.opacity = 0.55;
        grid.position.y = -1.62;
        root.add(grid);
        root.add(new THREE.AxesHelper(2.35));
      }

      const cutPlane = new THREE.Plane(normal.clone(), offset);
      const geometry = makeCutGeometry(geometryKind);
      const solidMaterial = new THREE.MeshStandardMaterial({
        clippingPlanes: cutEnabled ? [cutPlane] : [],
        clipShadows: true,
        color: geometryColor,
        metalness: 0.04,
        opacity: solidOpacity / 100,
        roughness: 0.55,
        side: THREE.DoubleSide,
        transparent: true,
      });
      const mesh = new THREE.Mesh(geometry, solidMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);

      const edgeMaterial = new THREE.LineBasicMaterial({
        clippingPlanes: cutEnabled ? [cutPlane] : [],
        color: helperColor,
        opacity: 0.52,
        transparent: true,
      });
      root.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));

      if (hollowMode !== "off") {
        const hollow = new THREE.Mesh(
          makeCutGeometry(geometryKind),
          new THREE.MeshBasicMaterial({
            color: "#ffffff",
            opacity: 0.18,
            transparent: true,
            wireframe: hollowMode === "tunnel",
          }),
        );
        const hollowScale = Math.max(0.18, hollowSize / 100);
        hollow.scale.set(hollowMode === "tunnel" ? hollowScale : hollowScale, hollowMode === "tunnel" ? 1.22 : hollowScale, hollowScale);
        root.add(hollow);
      }

      const planePosition = normal.clone().multiplyScalar(-offset);
      const planeQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

      if (showPlane) {
        const planeMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(planeSize, planeSize),
          new THREE.MeshBasicMaterial({
            color: planeColor,
            opacity: cutEnabled ? 0.16 : 0.08,
            side: THREE.DoubleSide,
            transparent: true,
          }),
        );
        planeMesh.position.copy(planePosition);
        planeMesh.quaternion.copy(planeQuaternion);
        root.add(planeMesh);

        const planeEdge = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(planeSize, planeSize)),
          new THREE.LineBasicMaterial({ color: planeColor, opacity: 0.72, transparent: true }),
        );
        planeEdge.position.copy(planePosition);
        planeEdge.quaternion.copy(planeQuaternion);
        root.add(planeEdge);
      }

      const previewGeometry = makeSectionPreviewGeometry(sectionInfo.preview);
      const preview = new THREE.Mesh(
        previewGeometry,
        new THREE.MeshBasicMaterial({
          color: sectionColor,
          opacity: cutEnabled ? 0.62 : 0.22,
          side: THREE.DoubleSide,
          transparent: true,
        }),
      );
      preview.position.copy(planePosition.add(normal.clone().multiplyScalar(0.014)));
      preview.quaternion.copy(planeQuaternion);
      root.add(preview);
      root.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(previewGeometry),
          new THREE.LineBasicMaterial({ color: sectionColor, opacity: 0.96, transparent: true }),
        ),
      );
      const lastChild = root.children[root.children.length - 1];
      lastChild.position.copy(preview.position);
      lastChild.quaternion.copy(preview.quaternion);

      return {
        animate: () => {
          if (spin) root.rotation.y += 0.006;
        },
      };
    },
    [
      angleX,
      angleY,
      angleZ,
      cutEnabled,
      geometryColor,
      geometryKind,
      helperColor,
      hollowMode,
      hollowSize,
      normal,
      offset,
      planeColor,
      planeSize,
      sectionColor,
      sectionInfo.preview,
      showAxes,
      showPlane,
      solidOpacity,
      spin,
    ],
  );

  const sceneKey = [
    "cut",
    geometryKind,
    angleX,
    angleY,
    angleZ,
    offset,
    planeSize,
    solidOpacity,
    hollowMode,
    hollowSize,
    cutEnabled,
    showPlane,
    showAxes,
    keepNegative,
    spin,
    geometryColor,
    planeColor,
    sectionColor,
    helperColor,
  ].join("-");

  return (
    <section className="three-tool three-cut-tool soft-card overflow-hidden p-0">
      <div className="three-cut-shell" style={{ width: "100%", height: "min(820px, calc(100vh - 96px))", minHeight: 700, display: "flex", overflow: "hidden", background: "#f1f2f4", fontFamily: "Microsoft YaHei, PingFang SC, sans-serif" }}>
        <div className="three-cut-stage-wrap" style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
          <ThreeStage buildScene={buildScene} sceneKey={sceneKey} />
          {directEdit && (
            <div
              className="three-cut-direct-layer"
              onPointerDown={startPlaneDrag}
              onPointerMove={movePlaneDrag}
              onPointerUp={stopPlaneDrag}
              onPointerCancel={stopPlaneDrag}
              style={{
                alignItems: "center",
                cursor: operation === "move" ? "ns-resize" : operation === "rotate" ? "grab" : "nesw-resize",
                display: "flex",
                inset: 0,
                justifyContent: "center",
                position: "absolute",
                zIndex: 8,
              }}
            >
              <div
                className="three-cut-direct-hint"
                style={{
                  background: draggingPlane ? "rgba(177,30,26,.92)" : "rgba(255,255,255,.88)",
                  border: draggingPlane ? "1px solid #b11e1a" : "1px solid rgba(177,30,26,.28)",
                  borderRadius: 999,
                  boxShadow: "0 6px 18px rgba(0,0,0,.12)",
                  color: draggingPlane ? "#fff" : "#b11e1a",
                  fontSize: 12,
                  fontWeight: 800,
                  padding: "8px 14px",
                  pointerEvents: "none",
                  transform: "translateY(-72px)",
                }}
              >
                {operation === "move" ? "拖动移动切面" : operation === "rotate" ? "拖动改变切向" : "拖动缩放切面"}
              </div>
            </div>
          )}

          <div className="three-cut-floating-actions" style={{ position: "absolute", left: 18, top: 18, display: "flex", gap: 8, zIndex: 10 }}>
            <button onClick={() => setDirectEdit((value) => !value)} style={{ ...cutModeButtonStyle, background: directEdit ? "#b11e1a" : "#fff", color: directEdit ? "#fff" : "#374151" }}>
              {directEdit ? "拖动切面" : "观察模型"}
            </button>
            <button onClick={() => setSpin((value) => !value)} style={{ ...cutModeButtonStyle, background: spin ? "#b11e1a" : "#fff", color: spin ? "#fff" : "#374151" }}>
              {spin ? "停止旋转" : "自动旋转"}
            </button>
            <button onClick={() => setShowAxes((value) => !value)} style={{ ...cutModeButtonStyle, background: showAxes ? "#b11e1a" : "#fff", color: showAxes ? "#fff" : "#374151" }}>
              {showAxes ? "隐藏坐标" : "显示坐标"}
            </button>
          </div>

          <div className="three-cut-info" style={{ position: "absolute", bottom: 18, left: 18, maxWidth: 560, color: "#333", fontSize: 13, background: "rgba(255,255,255,.94)", backdropFilter: "blur(10px)", border: "1px solid rgba(0,0,0,.08)", padding: "10px 14px", borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,.08)", lineHeight: 1.7, zIndex: 9 }}>
            <strong style={{ color: "#b11e1a" }}>{sectionInfo.title}</strong>
            <span style={{ marginLeft: 8 }}>{sectionInfo.desc}</span>
          </div>
        </div>

        <aside className="three-cut-panel" style={{ width: 300, minWidth: 300, height: "100%", background: "linear-gradient(180deg,#fff,#f8f8f8)", boxShadow: "-2px 0 16px rgba(0,0,0,.08)", overflowY: "auto", padding: "14px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px 11px", borderBottom: "1px solid #e0e0e0", marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#263238" }}>几何体切割控制面板</span>
          </div>

          <CutPanelSection title="选择几何体">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
              {cutGeometryOptions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setGeometryKind(item.id)}
                  style={{
                    alignItems: "center",
                    background: geometryKind === item.id ? "#fff4f3" : "#fff",
                    border: geometryKind === item.id ? "2px solid #b11e1a" : "1px solid #e1e5ea",
                    borderRadius: 8,
                    color: geometryKind === item.id ? "#b11e1a" : "#374151",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    fontWeight: 800,
                    minHeight: 58,
                    padding: "7px 4px",
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1.1 }}>{item.short}</span>
                  <span style={{ fontSize: 11, marginTop: 4 }}>{item.title}</span>
                </button>
              ))}
            </div>
            <p style={{ margin: "8px 2px 0", color: "#6b7280", fontSize: 11, lineHeight: 1.55 }}>{currentGeometry.desc}</p>
          </CutPanelSection>

          <CutPanelSection title="几何体操作">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
              {(["move", "rotate", "scale"] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setOperation(item)}
                  style={{ ...cutModeButtonStyle, background: operation === item ? "#b11e1a" : "#f8f9fa", color: operation === item ? "#fff" : "#495057" }}
                >
                  {item === "move" ? "移动" : item === "rotate" ? "旋转" : "缩放"}
                </button>
              ))}
            </div>
            <label style={cutLabelStyle}>
              透明度 {solidOpacity}%
              <input type="range" min="20" max="90" value={solidOpacity} onChange={(event) => setSolidOpacity(Number(event.target.value))} style={{ width: "100%", accentColor: "#b11e1a" }} />
            </label>
          </CutPanelSection>

          <CutPanelSection title="挖空操作">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
              {(["off", "center", "tunnel"] as const).map((item) => (
                <button
                  key={item}
                  onClick={() => setHollowMode(item)}
                  style={{ ...cutModeButtonStyle, background: hollowMode === item ? "#b11e1a" : "#f8f9fa", color: hollowMode === item ? "#fff" : "#495057" }}
                >
                  {item === "off" ? "关闭" : item === "center" ? "中心" : "贯穿"}
                </button>
              ))}
            </div>
            <label style={cutLabelStyle}>
              挖空尺寸 {hollowSize}%
              <input type="range" min="18" max="82" value={hollowSize} onChange={(event) => setHollowSize(Number(event.target.value))} style={{ width: "100%", accentColor: "#b11e1a" }} />
            </label>
          </CutPanelSection>

          <CutPanelSection title="剪切操作">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6 }}>
              <button onClick={() => setCutEnabled((value) => !value)} style={{ ...cutModeButtonStyle, background: cutEnabled ? "#b11e1a" : "#f8f9fa", color: cutEnabled ? "#fff" : "#495057" }}>
                {cutEnabled ? "关闭剪切" : "开启剪切"}
              </button>
              <button onClick={() => setShowPlane((value) => !value)} style={{ ...cutModeButtonStyle, background: showPlane ? "#b11e1a" : "#f8f9fa", color: showPlane ? "#fff" : "#495057" }}>
                {showPlane ? "隐藏切面" : "显示切面"}
              </button>
              <button onClick={() => setKeepNegative(false)} style={{ ...cutModeButtonStyle, background: !keepNegative ? "#b11e1a" : "#f8f9fa", color: !keepNegative ? "#fff" : "#495057" }}>
                保留上侧
              </button>
              <button onClick={() => setKeepNegative(true)} style={{ ...cutModeButtonStyle, background: keepNegative ? "#b11e1a" : "#f8f9fa", color: keepNegative ? "#fff" : "#495057" }}>
                保留下侧
              </button>
            </div>
          </CutPanelSection>

          <CutPanelSection title="切向控制">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6, marginBottom: 8 }}>
              <button onClick={() => setCutDirection("horizontal")} style={{ ...cutModeButtonStyle, background: "#f8f9fa", color: "#495057" }}>
                水平平切
              </button>
              <button onClick={() => setCutDirection("side")} style={{ ...cutModeButtonStyle, background: "#f8f9fa", color: "#495057" }}>
                左右竖切
              </button>
              <button onClick={() => setCutDirection("front")} style={{ ...cutModeButtonStyle, background: "#f8f9fa", color: "#495057" }}>
                前后竖切
              </button>
              <button onClick={() => setCutDirection("slant")} style={{ ...cutModeButtonStyle, background: "#b11e1a", color: "#fff" }}>
                常用斜切
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
              <button onClick={() => nudgeCutDirection("x", -10)} style={cutModeButtonStyle}>X-</button>
              <button onClick={() => nudgeCutDirection("y", -10)} style={cutModeButtonStyle}>Y-</button>
              <button onClick={() => nudgeCutDirection("z", -10)} style={cutModeButtonStyle}>Z-</button>
              <button onClick={() => nudgeCutDirection("x", 10)} style={cutModeButtonStyle}>X+</button>
              <button onClick={() => nudgeCutDirection("y", 10)} style={cutModeButtonStyle}>Y+</button>
              <button onClick={() => nudgeCutDirection("z", 10)} style={cutModeButtonStyle}>Z+</button>
            </div>
          </CutPanelSection>

          <CutPanelSection title="切面操作">
            <label style={cutLabelStyle}>
              移动 {offset.toFixed(1)}
              <input type="range" min="-1.55" max="1.55" step="0.05" value={offset} onChange={(event) => setOffset(Number(event.target.value))} style={{ width: "100%", accentColor: "#b11e1a" }} />
            </label>
            <label style={cutLabelStyle}>
              X轴旋转 {angleX}°
              <input type="range" min="-80" max="80" value={angleX} onChange={(event) => setAngleX(Number(event.target.value))} style={{ width: "100%", accentColor: "#b11e1a" }} />
            </label>
            <label style={cutLabelStyle}>
              Y轴旋转 {angleY}°
              <input type="range" min="-80" max="80" value={angleY} onChange={(event) => setAngleY(Number(event.target.value))} style={{ width: "100%", accentColor: "#b11e1a" }} />
            </label>
            <label style={cutLabelStyle}>
              Z轴旋转 {angleZ}°
              <input type="range" min="-80" max="80" value={angleZ} onChange={(event) => setAngleZ(Number(event.target.value))} style={{ width: "100%", accentColor: "#b11e1a" }} />
            </label>
            <label style={cutLabelStyle}>
              切面大小 {planeSize.toFixed(1)}
              <input type="range" min="2.4" max="6.4" step="0.1" value={planeSize} onChange={(event) => setPlaneSize(Number(event.target.value))} style={{ width: "100%", accentColor: "#b11e1a" }} />
            </label>
            <button onClick={resetCut} style={{ ...cutModeButtonStyle, width: "100%", background: "#b11e1a", color: "#fff" }}>
              复位切面
            </button>
          </CutPanelSection>

          <CutPanelSection title="颜色配置">
            <div style={{ display: "grid", gap: 8 }}>
              {[
                ["几何体", geometryColor, setGeometryColor],
                ["切面", planeColor, setPlaneColor],
                ["截面", sectionColor, setSectionColor],
                ["辅助线", helperColor, setHelperColor],
              ].map(([label, value, setter]) => (
                <label key={label as string} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "#495057" }}>
                  {label as string}
                  <input type="color" value={value as string} onChange={(event) => (setter as React.Dispatch<React.SetStateAction<string>>)(event.target.value)} />
                </label>
              ))}
            </div>
          </CutPanelSection>
        </aside>
      </div>
    </section>
  );
}

function CutPanelSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 12, fontWeight: 700, color: "#495057", margin: "0 0 8px 4px", padding: "4px 0", textTransform: "uppercase", letterSpacing: ".5px", borderBottom: "1px solid #e0e0e0", textAlign: "center" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

const cutModeButtonStyle: CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #e9ecef",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const cutLabelStyle: CSSProperties = {
  display: "block",
  marginBottom: 10,
  fontSize: 12,
  fontWeight: 700,
  color: "#495057",
};

function makeSectionPoints(sides: number, radius: number) {
  if (sides === 4) {
    return [
      new THREE.Vector2(-1.25, -0.85),
      new THREE.Vector2(1.25, -0.85),
      new THREE.Vector2(1.25, 0.85),
      new THREE.Vector2(-1.25, 0.85),
    ];
  }
  return Array.from({ length: sides }, (_, index) => {
    const angle = -Math.PI / 2 + (index / sides) * Math.PI * 2;
    return new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}
