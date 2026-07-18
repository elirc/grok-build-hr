// HR Backend Entry Point
// Layered architecture demo: minimal setup here.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import employeeRoutes from './routes/employeeRoutes';
import leaveRoutes from './routes/leaveRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/employees', employeeRoutes);
app.use('/api/leave', leaveRoutes);

app.listen(PORT, () => console.log(`HR Backend on ${PORT}`));
