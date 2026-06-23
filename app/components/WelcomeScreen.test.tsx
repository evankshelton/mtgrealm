import { render, screen } from '@testing-library/react-native';
import WelcomeScreen from './WelcomeScreen';

describe('WelcomeScreen', () => {
  it('renders the welcome heading', async () => {
    await render(<WelcomeScreen />);
    expect(screen.getByText('Welcome to MTG App')).toBeTruthy();
  });

  it('renders the boilerplate subtitle', async () => {
    await render(<WelcomeScreen />);
    expect(
      screen.getByText('Your Expo boilerplate is up and running.')
    ).toBeTruthy();
  });
});
