import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Text } from "react-native";
import MapScreen from "../screens/MapScreen";
import ComparisonScreen from "../screens/ComparisonScreen";
import HistoryScreen from "../screens/HistoryScreen";
import SettingsScreen from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Map: "🗺️",
  Comparison: "📊",
  History: "📜",
  Settings: "⚙️",
};

function tabIcon(routeName) {
  return ({ focused }) => (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
      {TAB_ICONS[routeName]}
    </Text>
  );
}

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: tabIcon(route.name),
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
