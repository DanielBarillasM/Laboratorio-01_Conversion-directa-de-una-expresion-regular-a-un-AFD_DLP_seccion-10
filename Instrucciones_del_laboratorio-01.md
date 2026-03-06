# **Conversión directa de una expresión regular a un AFD y simulación del AFD**

**Fecha de entrega:** jueves 12 de marzo de 2026

**Horario:** 19:00 horas

**Modalidad** en grupos (máximo: tres personas)

**Ponderación:** 10 puntos

#### **Introducción**

El análisis léxico constituye la primera fase de un compilador. En esta etapa se definen
y reconocen los patrones que describen los tokens del lenguaje. Las expresiones regulares
permiten describir formalmente dichos patrones y los autómatas finitos constituyen el
mecanismo computacional que permite reconocerlos.

El método directo permite construir un autómata finito determinista (AFD) a partir de
una expresión regular, sin necesidad de pasar previamente por un autómata finito no
determinista (AFN). Este procedimiento se basa en la construcción de un árbol sintáctico, el
cálculo de anulable, primera posición, última posición y siguiente posición, para luego
determinar los estados y las transiciones del autómata resultante.

Una vez construido el AFD, es posible simular su funcionamiento para determinar si
una cadena pertenece o no al lenguaje asociado a la expresión regular. Este proceso consiste
en partir del estado inicial del autómata y consumir los símbolos de la cadena uno a uno,
siguiendo las transiciones correspondientes. Si al finalizar la lectura de la cadena el autómata
se encuentra en un estado de aceptación, se concluye que la cadena pertenece al lenguaje;
de lo contrario, se concluye que la cadena no pertenece al lenguaje.

#### **Objetivos**

**Objetivo general**

Implementar el algoritmo del método directo para construir un autómata finito
determinista a partir de una expresión regular.

**Objetivos específicos**

- Generar la tabla de transición de estados del autómata resultante.

- Utilizar el autómata construido para validar si una cadena pertenece o no al lenguaje
asociado a la expresión regular.

#### **Instrucciones**

Cada grupo deberá desarrollar un programa que implemente el método directo para
convertir una expresión regular en un AFD y simular el funcionamiento del autómata resultante.

**El programa deberá permitir:**

1. Ingresar una expresión regular.
2. Construir el AFD correspondiente utilizando el método directo.
3. Generar la tabla de transición de estados del autómata resultante.
4. Ingresar una cadena de caracteres.
5. Determinar si la cadena pertenece o no al lenguaje utilizando el AFD construido.

#### **Para evidenciar el funcionamiento del programa, cada grupo deberá grabar un video y subirlo a YouTube. En este video se deberá mostrar:**

1. La ejecución del programa.
2. El ingreso de tres expresiones regulares distintas y para cada una de estas se deberá:
   
   a. Mostrar la tabla de transición de estados del AFD resultante.

   b. Ingresar y validar una cadena que sí pertenezca al lenguaje asociado a la
   expresión regular.

   c. Ingresar y validar una cadena que no pertenezca al lenguaje asociado a la
   expresión regular.

#### **Observaciones y restricciones**

- La actividad deberá realizarse en los grupos que se conformaron al principio del
semestre.
- El lenguaje de programación a utilizar queda a elección del grupo.
- No es indispensable desarrollar una interfaz gráfica y el programa puede ejecutarse
desde consola, pero si un grupo desea utilizar una interfaz gráfica, puede hacerlo.
- Las expresiones regulares podrán incluir los operadores: unión (|), concatenación
(implícita), cerradura de Kleene (*), cerradura positiva (+), opcional (?).
- En las tres expresiones regulares utilizadas en la demostración deberán aparecer al
menos una vez todos los operadores requeridos. No es necesario que cada expresión
utilice todos los operadores, pero cada operador deberá aparecer al menos una vez en
alguna de las tres expresiones.
- El video no debe exceder cinco minutos de duración.
- El uso de librerías para expresiones regulares está estrictamente prohibido. El incumplimiento de esta restricción se penalizará colocando 0 puntos de nota.

#### **Rúbrica de evaluación**

| Criterio                                                                                      | Excelente (100%)                                                                                        | Bueno (66%)                                                                                 | Regular (33%)                                                                                         | Deficiente (0%)                                                                                               |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **1. Implementación del método directo y generación de tabla de transición de estados (60%)** | Las tres tablas de transición de estados son correctas y se utilizaron todos los operadores requeridos. | Dos tablas de transición de estados son correctas o no se utilizó algún operador requerido. | Solo una tabla de transición es correcta o no se utilizaron dos operadores requeridos.                | Las tres tablas de transición de estados son incorrectas o no se utilizaron tres o más operadores requeridos. |
| **2. Validación de cadenas de entrada (30%)**                                                 | Las seis cadenas de prueba fueron validadas correctamente.                                              | Cuatro cadenas fueron validadas correctamente.                                              | Dos cadenas fueron validadas correctamente.                                                           | Menos de dos cadenas fueron validadas correctamente.                                                          |
| **3. Calidad de la explicación en el video (10%)**                                            | La explicación del video es estructurada, clara y concisa.                                              | La explicación es clara y ordenada, aunque con menor fluidez.                               | La explicación es monótona, desorganizada, difícil de seguir o transmite el contenido con dificultad. | La explicación es desordenada, confusa o incompleta.                                                          |
