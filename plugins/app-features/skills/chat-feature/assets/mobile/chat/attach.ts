/**
 * Pick a photo and shrink it before it leaves the phone.
 *
 * Not an optimisation. An iPhone photo is about 12 megapixels. Vision models
 * bill by image DIMENSIONS and downsample anyway, so the extra pixels are paid
 * for and thrown away. And the body is JSON with base64 in it, a third larger
 * again, over a phone connection. 1024 px on the long edge is above what
 * models resolve and a tenth of the size.
 *
 * Needs: npx expo install expo-image-picker expo-image-manipulator
 * and NSCameraUsageDescription / NSPhotoLibraryUsageDescription in app config,
 * worded for what the photo is FOR (App Review reads them).
 */
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const MAX_EDGE = 1024;
/** Below about 0.6, small print in a photo stops being readable. */
const QUALITY = 0.7;

export interface Attachment {
  /** Local file uri, for the thumbnail. */
  uri: string;
  /** `data:image/jpeg;base64,…`, which is what the model gets. */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Null for every non-result: cancelled, permission refused, a file that will
 * not decode, a photo still downloading from iCloud. The caller does the same
 * thing in each case, and an error banner would lose the question already typed.
 */
export async function pickImage(source: 'camera' | 'library'): Promise<Attachment | null> {
  try {
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 1, exif: false })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (result.canceled || !result.assets?.[0]) return null;
    const asset = result.assets[0];

    // The picker's `quality` only re-encodes; it does not resize. Resize here.
    // Only the long edge, so a portrait photo is not squashed; and only DOWN,
    // so a small screenshot is not blown up.
    const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
    const w = asset.width ?? 0;
    const h = asset.height ?? 0;
    if (Math.max(w, h) > MAX_EDGE) context.resize(w >= h ? { width: MAX_EDGE } : { height: MAX_EDGE });

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ base64: true, compress: QUALITY, format: ImageManipulator.SaveFormat.JPEG });
    if (!saved.base64) return null;

    return { uri: saved.uri, dataUrl: `data:image/jpeg;base64,${saved.base64}`, width: saved.width, height: saved.height };
  } catch {
    return null;
  }
}
