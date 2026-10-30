import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import designTokens from '@societysaas/design-tokens';
import { ActivityScreen } from './screens/ActivityScreen';
import { AccountScreen } from './screens/AccountScreen';
import { OverviewScreen } from './screens/OverviewScreen';

const Tab = createBottomTabNavigator();
const { colors } = designTokens;

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.navy900,
    primary: '#ffffff',
    text: colors.text,
    border: colors.navy800,
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
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
          <Tab.Screen name="Account" component={AccountScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
