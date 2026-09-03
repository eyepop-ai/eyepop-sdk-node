/**
 * Camera calibration for a source, as accepted by the worker's setSource.
 *
 * A calibration is what turns a depth map into measurable world coordinates.
 * Without one the worker falls back to an assumed horizontal field of view,
 * which is a development scaffold rather than something to ship: for canonical
 * metric depth the guess cancels out of X and Y and survives only in Z, so
 * lateral measurements stay exact while every distance along the optical axis
 * is wrong by however wrong the guess was.
 *
 * Mirrors what the instance API accepts. validateCamera() checks it locally so
 * a bad calibration is an error here rather than a 400 halfway through an
 * upload; the worker validates authoritatively, and the two are meant to agree.
 */

/**
 * How far a rotation's norm may sit from 1 and still be taken for a rotation.
 * Loose enough to survive a float round trip through JSON, tight enough to
 * catch an un-normalised or garbage one. Matches the instance and the worker.
 */
export const QUATERNION_TOLERANCE = 1e-3

/**
 * The pinhole parameters, normalised to the frame rather than given in pixels.
 *
 * Normalised so one calibration survives a resolution change: a camera
 * calibrated at 1920x1080 and later streamed at 1280x720 keeps working. Pixel
 * values carrying no calibration resolution are wrong by exactly the resolution
 * ratio, and nothing downstream can detect it.
 *
 * `fx`/`fy` are the focal length as a fraction of the frame's width and height;
 * `cx`/`cy` are the principal point in the same normalisation.
 */
export interface CameraIntrinsics {
    fx: number
    fy: number
    cx: number
    cy: number
}

/** The OpenCV Brown-Conrady coefficients. All zero is a rectilinear lens. */
export interface CameraDistortion {
    k1?: number
    k2?: number
    p1?: number
    p2?: number
    k3?: number
}

/** A rotation, w first. Must be a unit quaternion. */
export interface Quaternion {
    w: number
    x: number
    y: number
    z: number
}

/** A translation in metres. */
export interface Vector3d {
    x: number
    y: number
    z: number
}

/**
 * The camera's pose, expressed camera -> world.
 *
 * As `P_world = R(rotation) * P_camera + translation`, so the rotation carries
 * the camera's axes onto the world's and the translation is where the camera
 * itself sits. The world frame is Z up with the ground plane at Z = 0.
 *
 * This is the inverse of what cv2.solvePnP returns; a caller holding its
 * rvec/tvec must invert both halves (R = R_cv.T, t = -R_cv.T @ t_cv), and t_cv
 * is *not* the camera position.
 *
 * Left unset, the pose is the identity and world coordinates come back in the
 * camera frame instead - OpenCV convention, X right, Y down, Z forward.
 */
export interface CameraExtrinsics {
    rotation?: Quaternion
    translation?: Vector3d
}

/**
 * One source's calibration.
 *
 * Exactly one of `intrinsics` and `hfovDegrees` describes the lens. Both is
 * rejected rather than resolved by precedence - two descriptions of one lens
 * that disagree have no right answer - and neither is rejected too, since
 * defaulting a focal length would be inventing a lens.
 *
 * `hfovDegrees` is the shorthand for an operator who knows their lens's field
 * of view but not its calibration matrix. It assumes square pixels and a
 * centred principal point, so it approximates a real calibration rather than
 * replacing one - but it describes the actual lens rather than the worker's
 * assumed fallback. It composes with distortion and extrinsics exactly as
 * intrinsics do.
 */
export interface Camera {
    intrinsics?: CameraIntrinsics
    hfovDegrees?: number
    distortion?: CameraDistortion
    extrinsics?: CameraExtrinsics
}

function isFinite_(value: number | undefined): boolean {
    return value === undefined || Number.isFinite(value)
}

/**
 * Throw if the calibration cannot describe a real camera.
 *
 * Checked locally so a bad one fails before an upload starts rather than as a
 * 400 partway through it. The rules are the worker's, not stricter ones.
 */
export function validateCamera(camera: Camera): void {
    if (camera.intrinsics !== undefined && camera.hfovDegrees !== undefined) {
        throw new Error('camera.intrinsics and camera.hfovDegrees are alternatives, supply one')
    }
    if (camera.intrinsics === undefined && camera.hfovDegrees === undefined) {
        throw new Error('camera requires either camera.intrinsics or camera.hfovDegrees')
    }

    if (camera.hfovDegrees !== undefined) {
        // the upper bound excludes +Infinity, and every comparison with NaN is
        // false, so this one test covers the non-finite cases too
        if (!(camera.hfovDegrees > 0 && camera.hfovDegrees < 180)) {
            throw new Error('camera.hfovDegrees must be a horizontal field of view in (0, 180) degrees')
        }
    } else {
        const intrinsics = camera.intrinsics as CameraIntrinsics
        // note +Infinity passes a bare `> 0`, so finiteness is its own test
        for (const [name, focal] of [
            ['fx', intrinsics.fx],
            ['fy', intrinsics.fy],
        ] as const) {
            if (!(focal > 0) || !Number.isFinite(focal)) {
                throw new Error(`camera.intrinsics.${name} must be a positive, finite focal length`)
            }
        }
        for (const [name, principal, extent] of [
            ['cx', intrinsics.cx, 'width'],
            ['cy', intrinsics.cy, 'height'],
        ] as const) {
            if (!(principal >= 0 && principal <= 1)) {
                throw new Error(`camera.intrinsics.${name} must be within [0, 1] of the frame ${extent}`)
            }
        }
    }

    if (camera.distortion !== undefined) {
        for (const name of ['k1', 'k2', 'p1', 'p2', 'k3'] as const) {
            if (!isFinite_(camera.distortion[name])) {
                throw new Error(`camera.distortion.${name} must be a finite number`)
            }
        }
    }

    if (camera.extrinsics !== undefined) {
        const translation = camera.extrinsics.translation
        if (translation !== undefined) {
            for (const axis of ['x', 'y', 'z'] as const) {
                if (!Number.isFinite(translation[axis])) {
                    throw new Error(`camera.extrinsics.translation.${axis} must be a finite number`)
                }
            }
        }
        // a non-finite component makes the norm non-finite, so the unit test
        // below rejects it without a separate finiteness check
        const rotation = camera.extrinsics.rotation
        if (rotation !== undefined) {
            const norm = Math.sqrt(rotation.w ** 2 + rotation.x ** 2 + rotation.y ** 2 + rotation.z ** 2)
            if (!(Math.abs(norm - 1) <= QUATERNION_TOLERANCE)) {
                throw new Error('camera.extrinsics.rotation must be a unit quaternion')
            }
        }
    }
}
