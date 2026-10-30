import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import designTokens from '@societysaas/design-tokens';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AcceptInvitationScreen } from './screens/AcceptInvitationScreen';
import { AccountScreen } from './screens/AccountScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
import { LoginScreen } from './screens/LoginScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { ResetPasswordScreen } from './screens/ResetPasswordScreen';
import { SocietySettingsScreen } from './screens/SocietySettingsScreen';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen';
import { LoadingState } from './components/Feedback';
import { Screen } from './components/Screen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const { colors } = designTokens;

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.navy900,
    primary: colors.blue600,
    text: colors.text,
    border: colors.border,
  },
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: {
          color: colors.navy900,
          fontSize: 17,
          fontWeight: '600',
        },
        tabBarActiveTintColor: '#ffffff',
        tabBarInactiveTintColor: '#b8c5d6',
        tabBarStyle: {
          backgroundColor: colors.navy900,
          borderTopColor: colors.navy800,
          height: 62,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
      }}
    >
      <Tab.Screen name="Overview" component={OverviewScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Society" component={SocietySettingsScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

function AppNavigation() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <Screen>
        <LoadingState label="Checking your session" />
      </Screen>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.navy900 },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontSize: 16, fontWeight: '600' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      {isAuthenticated ? (
        <Stack.Screen component={MainTabs} name="Workspace" options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen component={LoginScreen} name="SignIn" options={{ title: 'Sign in' }} />
          <Stack.Screen
            component={ForgotPasswordScreen}
            name="ForgotPassword"
            options={{ title: 'Reset password' }}
          />
          <Stack.Screen
            component={ResetPasswordScreen}
            name="ResetPassword"
            options={{ title: 'New password' }}
          />
          <Stack.Screen
            component={AcceptInvitationScreen}
            name="AcceptInvitation"
            options={{ title: 'Accept invitation' }}
          />
          <Stack.Screen
            component={VerifyEmailScreen}
            name="VerifyEmail"
            options={{ title: 'Verify email' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

const linking = {
  prefixes: ['societysaas://'],
  config: {
    screens: {
      SignIn: 'login',
      ForgotPassword: 'forgot-password',
      ResetPassword: 'reset-password',
      AcceptInvitation: 'accept-invitation',
      VerifyEmail: 'verify-email',
    },
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer linking={linking} theme={navigationTheme}>
          <AppNavigation />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
