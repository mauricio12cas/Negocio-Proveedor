import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Tema } from '../Tema.jsx';
import { guardarTema, temaGuardado } from '../comun.js';
import Panel from './Panel.jsx';

function Raiz() {
  const [modo, setModo] = useState(temaGuardado);
  const [color, setColor] = useState(null);
  const cambiarModo = (m) => { guardarTema(m); setModo(m); };
  return (
    <Tema color={color} modo={modo}>
      <Panel modo={modo} cambiarModo={cambiarModo} cambiarColor={setColor} />
    </Tema>
  );
}

createRoot(document.getElementById('root')).render(<Raiz />);
