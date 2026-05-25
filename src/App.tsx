import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import MainMenu from "./pages/MainMenu";
import Index from "./pages/Index";
import SinglePlayer from "./pages/SinglePlayer";
import Tutorial from "./pages/Tutorial";
import Multiplayer from "./pages/Multiplayer";
import UnitRoster from "./pages/UnitRoster";
import AdminIcons from "./pages/AdminIcons";
import Simulator from "./pages/Simulator";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainMenu />} />
          <Route path="/singleplayer" element={<SinglePlayer />} />
          <Route path="/tutorial" element={<Tutorial />} />
          <Route path="/game" element={<Index />} />
          <Route path="/roster" element={<UnitRoster />} />
          <Route path="/multiplayer" element={<Multiplayer />} />
          <Route path="/admin" element={<AdminIcons />} />
          <Route path="/simulator" element={<Simulator />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
