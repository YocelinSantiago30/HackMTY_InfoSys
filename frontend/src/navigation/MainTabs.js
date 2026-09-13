import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import MapScreen from "../screens/MapScreen";
import ComparisonScreen from "../screens/ComparisonScreen";
import HistoryScreen from "../screens/HistoryScreen";
import SettingsScreen from "../screens/SettingsScreen";
import { AGENT_COLORS, TEXT_COLORS } from "../constants/theme";

const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Map: "map",
  Comparison: "bar-chart",
  History: "receipt",
  Settings: "settings",
};

function tabIcon(routeName) {
  return ({ focused }) => (
    <Ionicons
      name={focused ? TAB_ICONS[routeName] : `${TAB_ICONS[routeName]}-outline`}
      size={22}
      color={focused ? AGENT_COLORS.SMARTCOURIER : TEXT_COLORS.muted}
    />
  );
}

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: tabIcon(route.name),
        tabBarActiveTintColor: AGENT_COLORS.SMARTCOURIER,
        tabBarInactiveTintColor: TEXT_COLORS.muted,
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} options={{ title: "Mapa" }} />
      <Tab.Screen
        name="Comparison"
        component={ComparisonScreen}
        options={{ title: "Comparación" }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{ title: "Historial" }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "Ajustes" }}
      />
    </Tab.Navigator>
  );
}
