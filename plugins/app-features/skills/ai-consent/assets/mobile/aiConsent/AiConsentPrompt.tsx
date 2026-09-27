/**
 * The consent prompt, as an OVERLAY, not a Modal.
 *
 * AI features often live in Modals (a chat sheet, a photo sheet), and iOS will
 * not present a second Modal over one that is up. So render this inside each
 * AI host AND once at the root. Whichever is on top is the one people see;
 * they all answer the same pending check.
 *
 * The text must say: WHAT is sent, WHO receives it (name the provider), WHY,
 * and link the privacy policy. "We use AI" alone is what App Review rejects.
 */
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAiConsentStore } from './store';

const PROVIDER = 'OpenAI';                                  // the company that receives the data
const PRIVACY_URL = 'https://example.com/privacy';

export function AiConsentPrompt() {
  const asking = useAiConsentStore((s) => s.asking);
  const answer = useAiConsentStore((s) => s.answer);
  if (!asking) return null;

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Pressable style={styles.scrim} onPress={() => answer(false)} accessibilityLabel="Not now" />
      <View style={styles.sheet}>
        <Text style={styles.title}>Using AI in MyApp</Text>
        <Text style={styles.body}>
          To answer you, MyApp sends what you write, the photos you add, and the parts of your
          MyApp data the answer needs to {PROVIDER}, an AI service. It is used only to answer you
          and is not used to train AI models.
        </Text>
        <Pressable onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
          <Text style={styles.link}>Read the privacy policy</Text>
        </Pressable>
        <Pressable onPress={() => answer(true)} accessibilityRole="button" style={styles.agree}>
          <Text style={styles.agreeText}>Agree</Text>
        </Pressable>
        <Pressable onPress={() => answer(false)} accessibilityRole="button" style={styles.later}>
          <Text style={styles.laterText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { position: 'absolute', left: 12, right: 12, bottom: 24, backgroundColor: '#fbfaf7', borderRadius: 24, padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: '600', color: '#1c1b19' },
  body: { fontSize: 16, lineHeight: 23, color: '#1c1b19' },
  link: { fontSize: 15, textDecorationLine: 'underline', color: '#1c1b19' },
  agree: { backgroundColor: '#1c1b19', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  agreeText: { color: '#fbfaf7', fontSize: 16, fontWeight: '600' },
  later: { paddingVertical: 10, alignItems: 'center' },
  laterText: { color: '#6b675f', fontSize: 15 },
});
