-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Servidor: 127.0.0.1
-- Tiempo de generación: 28-10-2025 a las 18:56:30
-- Versión del servidor: 10.4.32-MariaDB
-- Versión de PHP: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Base de datos: `biblioteca_yeak8`
--

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `libros`
--

CREATE TABLE `libros` (
  `id_libro` int(11) NOT NULL,
  `titulo` varchar(150) NOT NULL,
  `autor` varchar(100) DEFAULT NULL,
  `categoria` varchar(100) DEFAULT NULL,
  `fecha_publicacion` date DEFAULT NULL,
  `estatus` varchar(30) DEFAULT 'disponible',
  `link_archivo` text DEFAULT NULL,
  `link_imagen` text DEFAULT NULL,
  `fecha_registro` date DEFAULT curdate(),
  `tipo` varchar(20) DEFAULT NULL,
  `usuario` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `prestamos`
--

CREATE TABLE `prestamos` (
  `id_prestamo` int(11) NOT NULL,
  `fecha_prestamo` varchar(50) DEFAULT NULL,
  `fecha_limite` date NOT NULL,
  `fecha_devolucion` date DEFAULT NULL,
  `estado` varchar(30) DEFAULT 'activo',
  `renovacion` int(11) DEFAULT 0,
  `usuario` int(11) NOT NULL,
  `libro` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estructura de tabla para la tabla `usuarios`
--

CREATE TABLE `usuarios` (
  `id_usuario` int(11) NOT NULL,
  `matricula` varchar(50) DEFAULT NULL,
  `correo` varchar(100) NOT NULL,
  `contraseña` varchar(255) NOT NULL,
  `rol` varchar(30) NOT NULL,
  `multa` varchar(20) DEFAULT 'ninguna',
  `intentos_fallidos` int(11) DEFAULT 0,
  `tiempo_bloqueo` datetime DEFAULT NULL,
  `expiracion_temp_pass` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Volcado de datos para la tabla `usuarios`
--

INSERT INTO `usuarios` (`id_usuario`, `matricula`, `correo`, `contraseña`, `rol`, `multa`, `intentos_fallidos`, `tiempo_bloqueo`, `expiracion_temp_pass`) VALUES
(1, 'E21080748', 'E21080748@merida.tecnm.mx', '$2a$10$anNSGCvhnNKCUQZ5lKeu4ewnoDCcm.6juuB251A/z68UeCzMZDTVy', 'Estudiante', 'ninguna', 0, NULL, NULL),
(2, 'E21080749', 'biakbiak25uwu@gmail.com', '$2b$10$Rb2/H3WxJMG2/M9AKgPylO8XdaH7g/0wR7LvvCV0x7af2gYYmsunS', 'Estudiante', 'ninguna', 0, NULL, NULL),
(3, 'E21080740', 'biakbiak5uwu@gmail.com', '$2b$10$Z63.4TWljsLPA//1pZsSsuYwP8wWwGWDQlHcrUdlJ32nhTrFpdHuG', 'Estudiante', 'ninguna', 3, '2025-10-28 03:14:21', NULL),
(4, 'E21080730', 'biakbiak5uw@8.com', '$2b$10$BISGXWZWKz7XVh3mrz1Vneug4T0oHoNB.iRX/qv5zoP20LpzXzJHq', 'Estudiante', 'ninguna', 0, NULL, NULL),
(5, 'E21080747', 'yomaeuanh@gmail.com', '$2b$10$Yw3uUL707fCkgTE0FafgL.aDRvd0Kxh/IUhmqkxDMTcT.5jrYIWXS', 'Estudiante', 'ninguna', 3, '2025-10-28 11:55:37', NULL),
(6, 'E21080746', 'yomyeh25@gmail.com', '$2b$10$JQr0Q/aBmbLsNRSC3xmmWuKVl4QLLjhmFzAmfz.kKKPNk81O5MYaW', 'Estudiante', 'ninguna', 0, NULL, NULL);

--
-- Índices para tablas volcadas
--

--
-- Indices de la tabla `libros`
--
ALTER TABLE `libros`
  ADD PRIMARY KEY (`id_libro`),
  ADD KEY `usuario` (`usuario`);

--
-- Indices de la tabla `prestamos`
--
ALTER TABLE `prestamos`
  ADD PRIMARY KEY (`id_prestamo`),
  ADD KEY `usuario` (`usuario`),
  ADD KEY `libro` (`libro`);

--
-- Indices de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`id_usuario`),
  ADD UNIQUE KEY `matricula` (`matricula`);

--
-- AUTO_INCREMENT de las tablas volcadas
--

--
-- AUTO_INCREMENT de la tabla `libros`
--
ALTER TABLE `libros`
  MODIFY `id_libro` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `prestamos`
--
ALTER TABLE `prestamos`
  MODIFY `id_prestamo` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de la tabla `usuarios`
--
ALTER TABLE `usuarios`
  MODIFY `id_usuario` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- Restricciones para tablas volcadas
--

--
-- Filtros para la tabla `libros`
--
ALTER TABLE `libros`
  ADD CONSTRAINT `libros_ibfk_1` FOREIGN KEY (`usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Filtros para la tabla `prestamos`
--
ALTER TABLE `prestamos`
  ADD CONSTRAINT `prestamos_ibfk_1` FOREIGN KEY (`usuario`) REFERENCES `usuarios` (`id_usuario`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `prestamos_ibfk_2` FOREIGN KEY (`libro`) REFERENCES `libros` (`id_libro`) ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
