import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";

export interface UnityCameraControlsHandle {
  target: THREE.Vector3;
  focus: (box: THREE.Box3) => void;
}

export const UnityCameraControls = forwardRef<
  UnityCameraControlsHandle,
  {
    focusBox?: THREE.Box3 | null;
    side?: string;
    syncState?: React.MutableRefObject<{
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      target: THREE.Vector3;
    }>;
    masterLock?: React.MutableRefObject<string | null>;
  }
>(({ focusBox, side, syncState, masterLock }, ref) => {
  const { camera, gl } = useThree();
  const target = useRef(new THREE.Vector3(0, 0, 0));
  const yaw = useRef(0);
  const pitch = useRef(0);
  const spherical = useRef(new THREE.Spherical());
  const mouse = useRef({ left: false, middle: false, right: false });
  const prevPointer = useRef({ x: 0, y: 0 });
  const keys = useRef(new Set<string>());
  const flySpeed = useRef(15);
  const orbDelta = useRef({ theta: 0, phi: 0 });
  const panDelta = useRef({ x: 0, y: 0 });
  const dollyAccum = useRef(0);

  useEffect(() => {
    target.current.set(0, 0, 0);
    camera.lookAt(target.current);
    camera.updateMatrixWorld();

    const e = new THREE.Euler(0, 0, 0, "YXZ");
    e.setFromQuaternion(camera.quaternion);
    yaw.current = e.y;
    pitch.current = e.x;
    spherical.current.setFromVector3(
      new THREE.Vector3().subVectors(camera.position, target.current),
    );
  }, [camera]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();

      if (k === "f" && focusBox) {
        e.preventDefault();
        e.stopPropagation();
        handleFocus(focusBox);
        return;
      }

      if (!["w", "a", "s", "d", "q", "e", "shift"].includes(k)) return;
      if (mouse.current.right) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (e.type === "keydown") keys.current.add(k);
      else keys.current.delete(k);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keyup", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keyup", onKey, { capture: true });
    };
  }, [focusBox]);

  useEffect(() => {
    const el = gl.domElement;

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) mouse.current.left = true;
      if (e.button === 1) mouse.current.middle = true;
      if (e.button === 2) mouse.current.right = true;
      prevPointer.current = { x: e.clientX, y: e.clientY };

      if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
        el.setPointerCapture(e.pointerId);
      }
    };

    const onUp = (e: PointerEvent) => {
      if (e.button === 0) mouse.current.left = false;
      if (e.button === 1) mouse.current.middle = false;
      if (e.button === 2) mouse.current.right = false;
    };

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - prevPointer.current.x;
      const dy = e.clientY - prevPointer.current.y;
      prevPointer.current = { x: e.clientX, y: e.clientY };
      if (dx === 0 && dy === 0) return;

      if (mouse.current.right) {
        const s = 0.003;
        yaw.current -= dx * s;
        pitch.current -= dy * s;
        pitch.current = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch.current));
        return;
      }

      if (mouse.current.left && e.altKey) {
        const s = 0.005;
        orbDelta.current.theta -= dx * s;
        orbDelta.current.phi -= dy * s;
        return;
      }

      if (mouse.current.middle) {
        panDelta.current.x += dx;
        panDelta.current.y += dy;
        return;
      }
    };

    const onContext = (e: Event) => e.preventDefault();
    const onLeave = () => {
      mouse.current.left = false;
      mouse.current.middle = false;
      mouse.current.right = false;
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("contextmenu", onContext);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("contextmenu", onContext);
    };
  }, [gl]);

  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (mouse.current.right) {
        flySpeed.current = Math.max(1, Math.min(100, flySpeed.current - e.deltaY * 0.1));
      } else {
        dollyAccum.current -= e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel as EventListener, { passive: false } as AddEventListenerOptions);
    return () => el.removeEventListener("wheel", onWheel as EventListener, { passive: false } as AddEventListenerOptions);
  }, [gl]);

  const handleFocus = (box: THREE.Box3) => {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    const dist = maxDim / (2 * Math.tan((fov * Math.PI / 180) / 2));
    const finalDist = dist * 1.8;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    camera.position.copy(center).addScaledVector(dir, -finalDist);
    target.current.copy(center);
    camera.lookAt(center);
    camera.updateMatrixWorld();

    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    euler.setFromQuaternion(camera.quaternion);
    yaw.current = euler.y;
    pitch.current = euler.x;
    spherical.current.setFromVector3(new THREE.Vector3().subVectors(camera.position, target.current));
  };

  useImperativeHandle(
    ref,
    () => ({ target: target.current, focus: handleFocus }),
    [],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    if (dollyAccum.current !== 0) {
      const dir = new THREE.Vector3().subVectors(target.current, camera.position).normalize();
      camera.position.addScaledVector(dir, dollyAccum.current * 0.05);
      camera.lookAt(target.current);
      camera.updateMatrixWorld();

      const euler = new THREE.Euler(0, 0, 0, "YXZ");
      euler.setFromQuaternion(camera.quaternion);
      yaw.current = euler.y;
      pitch.current = euler.x;
      spherical.current.setFromVector3(new THREE.Vector3().subVectors(camera.position, target.current));
      dollyAccum.current = 0;
    }

    if (panDelta.current.x !== 0 || panDelta.current.y !== 0) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      const sens = 0.01 * Math.max(spherical.current.radius * 0.5, 1);
      const offset = new THREE.Vector3()
        .addScaledVector(right, -panDelta.current.x * sens)
        .addScaledVector(up, panDelta.current.y * sens);
      camera.position.add(offset);
      target.current.add(offset);
      panDelta.current.x = 0;
      panDelta.current.y = 0;
    }

    if (orbDelta.current.theta !== 0 || orbDelta.current.phi !== 0) {
      spherical.current.theta -= orbDelta.current.theta;
      spherical.current.phi -= orbDelta.current.phi;
      spherical.current.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.current.phi));

      const pos = new THREE.Vector3().setFromSpherical(spherical.current).add(target.current);
      camera.position.copy(pos);
      camera.lookAt(target.current);
      camera.updateMatrixWorld();

      const euler = new THREE.Euler(0, 0, 0, "YXZ");
      euler.setFromQuaternion(camera.quaternion);
      yaw.current = euler.y;
      pitch.current = euler.x;
      orbDelta.current.theta = 0;
      orbDelta.current.phi = 0;
    }

    if (mouse.current.right) {
      const speed = flySpeed.current * (keys.current.has("shift") ? 3 : 1);
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();

      const move = new THREE.Vector3();
      if (keys.current.has("w")) move.add(forward);
      if (keys.current.has("s")) move.sub(forward);
      if (keys.current.has("a")) move.sub(right);
      if (keys.current.has("d")) move.add(right);
      if (keys.current.has("q")) move.add(up);
      if (keys.current.has("e")) move.sub(up);

      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed * dt);
        camera.position.add(move);
        target.current.add(move);
      }

      const euler = new THREE.Euler(pitch.current, yaw.current, 0, "YXZ");
      camera.quaternion.setFromEuler(euler);
      camera.updateMatrixWorld();
    }

    if (syncState && side && masterLock) {
      if (masterLock.current === side) {
        syncState.current.position.copy(camera.position);
        syncState.current.quaternion.copy(camera.quaternion);
        syncState.current.target.copy(target.current);
      } else if (masterLock.current !== null) {
        camera.position.copy(syncState.current.position);
        camera.quaternion.copy(syncState.current.quaternion);
        target.current.copy(syncState.current.target);
      }
    }
  });

  return null;
});
