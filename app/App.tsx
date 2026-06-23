import { StatusBar } from 'expo-status-bar';
import WelcomeScreen from './components/WelcomeScreen';

export default function App() {
  return (
    <>
      <WelcomeScreen />
      <StatusBar style="auto" />
    </>
  );
}
