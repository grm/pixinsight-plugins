// Blink des poses
// Parcourt un dossier, note les lights, les fait défiler, et envoie les conservées
// à WeightedBatchPreprocessing avec les darks, flats et bias trouvés à côté.

#engine v8

#feature-id BlinkCull : Astrogrm > BlinkCull

#feature-info Parcourt un dossier, note les poses, les fait défiler et envoie les conservées à WeightedBatchPreprocessing.

#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/DataType.jsh>
#include <pjsr/KeyCodes.jsh>

#include "BlinkCull-Grade.js"
#include "BlinkCull-Session.js"
#include "BlinkCull-Dialog.js"

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

function blinkCullArg( name )
{
   for ( let i = 0; i < Runtime.jsArguments.length; ++i )
   {
      let arg = Runtime.jsArguments[ i ];
      if ( arg == name )
         return true;
      if ( arg.indexOf( name + "=" ) == 0 )
         return arg.substring( name.length + 1 );
   }
   return undefined;
}

function main()
{
   if ( blinkCullArg( "checkSyntax" ) )
   {
      blinkCullSelfCheck();
      let dialog = new BlinkCullDialog();
      console.writeln( "BlinkCull syntax ok, fenêtre construite." );
      return;
   }
   let dialog = new BlinkCullDialog();
   dialog.execute();
}

main();
