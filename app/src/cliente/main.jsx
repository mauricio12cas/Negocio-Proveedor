import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Tema } from '../Tema.jsx';
import Cliente from './Cliente.jsx';

function Raiz() {
  const [color, setColor] = useState(null);
  return (
    <Tema color={color} modo="sistema">
      <Cliente alCargarMarca={setColor} />
    </Tema>
  );
}

createRoot(document.getElementById('root')).render(<Raiz />);
